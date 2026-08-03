package sync

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"olifant/sync-sp-api/internal/amazon"
	"olifant/sync-sp-api/internal/db"
	"olifant/sync-sp-api/internal/tokencrypto"
)

const syncTypeCatalogItems = "catalog_items"

// CatalogResult summarises one SyncCatalog run.
type CatalogResult struct {
	AccountsOK     int
	AccountsFailed int
	RecordsWritten int
}

// CatalogOrchestrator drives the two-phase GET_MERCHANT_LISTINGS_ALL_DATA
// sync — same request/poll/download shape as SalesOrchestrator, reusing the
// sp_report_requests tracking table and amazon.Client's generic report
// methods. GET_MERCHANT_LISTINGS_ALL_DATA is a snapshot report (no date
// range), but sp_report_requests.start_date/end_date are NOT NULL, so
// today's date is used as a sentinel value for both — purely a dedup/resume
// key ("have we already requested a listings snapshot today for this
// account?"), not a real date range. Reusing that table as-is avoids
// migrating a column shared with the (working, unrelated) sales sync.
type CatalogOrchestrator struct {
	writer          *db.Writer
	lwaClientID     string
	lwaClientSecret string
	encryptionKey   []byte
}

func NewCatalogOrchestrator(w *db.Writer, lwaClientID, lwaClientSecret string, encryptionKey []byte) *CatalogOrchestrator {
	return &CatalogOrchestrator{
		writer:          w,
		lwaClientID:     lwaClientID,
		lwaClientSecret: lwaClientSecret,
		encryptionKey:   encryptionKey,
	}
}

func (o *CatalogOrchestrator) buildContexts(accounts []db.SpAccount) map[string]*accountContext {
	contexts := make(map[string]*accountContext, len(accounts))
	for _, a := range accounts {
		refreshToken, err := tokencrypto.Decrypt(o.encryptionKey, a.RefreshTokenEncrypted)
		if err != nil {
			log.Printf("WARN: account %s: decrypt refresh token failed: %v — skipping", a.SellingPartnerID, err)
			continue
		}
		client := amazon.NewClient(o.lwaClientID, o.lwaClientSecret, refreshToken)
		contexts[a.ID] = &accountContext{
			account: a,
			client:  client,
			tokens:  amazon.NewTokenManager(client),
			region:  amazon.RegionByName(a.Region),
		}
	}
	return contexts
}

// SyncCatalog is the single entry point for the listings/catalog sync.
func (o *CatalogOrchestrator) SyncCatalog(ctx context.Context, accounts []db.SpAccount) (*CatalogResult, error) {
	result := &CatalogResult{}
	contexts := o.buildContexts(accounts)

	// Sentinel "date range" — see type doc. Real value, just not a real range.
	today := time.Now().UTC().Format("2006-01-02")

	// ── Phase 1: submit report requests for every account concurrently ────────
	type phase1Out struct {
		accountID string
		err       error
	}

	sem := make(chan struct{}, phase1Concurrency)
	outCh := make(chan phase1Out, len(accounts))
	var wg sync.WaitGroup

	log.Printf("Phase 1: submitting merchant listings report requests for %d accounts", len(contexts))

	for _, ac := range contexts {
		wg.Add(1)
		go func(ac *accountContext) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out := phase1Out{accountID: ac.account.ID}
			a := ac.account

			_, existingReportID, found, err := o.writer.FindActiveReportRequest(ctx, a.ID, today, today)
			if err != nil {
				out.err = fmt.Errorf("find existing request: %w", err)
				outCh <- out
				return
			}
			if found {
				log.Printf("account %s (%s): resuming existing listings report %s", a.SellingPartnerID, a.Region, existingReportID)
				outCh <- out
				return
			}

			logID, err := o.writer.CreateAccountSyncLog(ctx, syncTypeCatalogItems, a.ID)
			if err != nil {
				out.err = fmt.Errorf("create sync log: %w", err)
				outCh <- out
				return
			}
			if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
				out.err = err
				outCh <- out
				return
			}

			token, err := ac.tokens.Token(ctx)
			if err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("get token: %w", err)
				outCh <- out
				return
			}

			// No date range sent to Amazon — GET_MERCHANT_LISTINGS_ALL_DATA is a
			// snapshot report; "" / "" are omitted from the request body.
			reportID, err := ac.client.RequestReport(ctx, token, ac.region, amazon.MerchantListingsReportType, a.Marketplace, "", "")
			if err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("request report: %w", err)
				outCh <- out
				return
			}

			if _, err := o.writer.InsertReportRequest(ctx, db.ReportRequestInsert{
				AmazonSPAccountID: a.ID,
				Region:            a.Region,
				ReportID:          reportID,
				StartDate:         today,
				EndDate:           today,
			}); err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("insert report request row: %w", err)
				outCh <- out
				return
			}

			log.Printf("account %s (%s): submitted listings report %s", a.SellingPartnerID, a.Region, reportID)
			outCh <- out
		}(ac)
	}

	wg.Wait()
	close(outCh)

	for out := range outCh {
		if out.err != nil {
			log.Printf("account %s: Phase 1 error: %v", out.accountID, out.err)
			result.AccountsFailed++
		}
	}

	// ── Phase 2: poll all pending rows from DB until terminal or timeout ──────
	log.Printf("Phase 2: polling until all listings reports complete or %s elapses", maxWait)
	deadline := time.Now().Add(maxWait)
	return result, o.pollPendingReports(ctx, deadline, result, contexts)
}

func (o *CatalogOrchestrator) pollPendingReports(ctx context.Context, deadline time.Time, result *CatalogResult, contexts map[string]*accountContext) error {
	for {
		pending, err := o.writer.GetPendingReportRequests(ctx)
		if err != nil {
			return fmt.Errorf("get pending requests: %w", err)
		}
		if len(pending) == 0 {
			break
		}

		if time.Now().After(deadline) {
			n, _ := o.writer.MarkTimedOutReportRequests(ctx, deadline)
			log.Printf("Phase 2: timeout — %d report(s) marked FATAL", n)
			result.AccountsFailed += n
			break
		}

		log.Printf("Phase 2: %d listings report(s) still pending, checking...", len(pending))

		type pollResult struct {
			row       db.PendingReportRequest
			written   int
			completed bool
			err       error
		}
		pollCh := make(chan pollResult, len(pending))
		pollSem := make(chan struct{}, phase2Concurrency)
		var pollWg sync.WaitGroup

		for _, row := range pending {
			pollWg.Add(1)
			go func(r db.PendingReportRequest) {
				defer pollWg.Done()
				pollSem <- struct{}{}
				defer func() { <-pollSem }()

				pr := pollResult{row: r}

				ac, ok := contexts[r.AmazonSPAccountID]
				if !ok {
					pr.err = fmt.Errorf("no account context for %s (decrypt failed earlier?)", r.AmazonSPAccountID)
					pollCh <- pr
					return
				}

				token, err := ac.tokens.Token(ctx)
				if err != nil {
					pr.err = fmt.Errorf("get token: %w", err)
					pollCh <- pr
					return
				}

				status, err := ac.client.GetReportStatus(ctx, token, ac.region, r.ReportID)
				if err != nil {
					pr.err = fmt.Errorf("poll status: %w", err)
					pollCh <- pr
					return
				}

				switch status.ProcessingStatus {
				case "DONE":
					_ = o.writer.TouchReportRequest(ctx, r.ID, "DONE")
					_ = o.writer.SetReportDocumentID(ctx, r.ID, status.ReportDocumentID)
					written, err := o.processCompleted(ctx, ac, r, status.ReportDocumentID)
					if err != nil {
						_ = o.writer.MarkReportTerminal(ctx, r.ID, "FATAL", err.Error())
						pr.err = err
					} else {
						_ = o.writer.DeleteReportRequest(ctx, r.ID)
						pr.written = written
						pr.completed = true
					}

				case "FATAL", "CANCELLED":
					_ = o.writer.MarkReportTerminal(ctx, r.ID, status.ProcessingStatus, status.ProcessingStatus)
					pr.err = fmt.Errorf("report %s: %s", r.ReportID, status.ProcessingStatus)

				default: // IN_QUEUE / IN_PROGRESS
					_ = o.writer.TouchReportRequest(ctx, r.ID, status.ProcessingStatus)
					log.Printf("  account %s: report %s still %s", ac.account.SellingPartnerID, r.ReportID, status.ProcessingStatus)
				}

				pollCh <- pr
			}(row)
		}

		pollWg.Wait()
		close(pollCh)

		for pr := range pollCh {
			if pr.err != nil {
				log.Printf("account %s: error: %v", pr.row.AmazonSPAccountID, pr.err)
				result.AccountsFailed++
			} else if pr.completed {
				result.AccountsOK++
				result.RecordsWritten += pr.written
				log.Printf("account %s: wrote %d catalog item rows", pr.row.AmazonSPAccountID, pr.written)
			}
		}

		if time.Now().Before(deadline) {
			remaining := time.Until(deadline)
			sleep := pollInterval
			if remaining < sleep {
				sleep = remaining
			}
			time.Sleep(sleep)
		}
	}

	return nil
}

// processCompleted downloads and parses the listings report, upserts one
// catalog_items row per listing, and propagates product_name into any
// matching product_economics row (never creating new ones, never touching
// margin/strategy/targets/launch_until).
func (o *CatalogOrchestrator) processCompleted(ctx context.Context, ac *accountContext, row db.PendingReportRequest, reportDocumentID string) (int, error) {
	token, err := ac.tokens.Token(ctx)
	if err != nil {
		return 0, fmt.Errorf("get token: %w", err)
	}

	listings, err := ac.client.DownloadMerchantListingsReport(ctx, token, ac.region, reportDocumentID)
	if err != nil {
		return 0, fmt.Errorf("download listings report: %w", err)
	}

	written := 0
	for _, l := range listings {
		if err := o.writer.UpsertCatalogItem(ctx, db.CatalogItemUpsert{
			AmazonSPAccountID: ac.account.ID,
			ASIN:              l.ASIN,
			SellerSKU:         l.SellerSKU,
			ProductName:       l.ProductName,
			Status:            l.Status,
		}); err != nil {
			return written, fmt.Errorf("upsert catalog item: %w", err)
		}
		written++

		if err := o.writer.PropagateProductName(ctx, ac.account.ClientID, l.ASIN, l.ProductName); err != nil {
			return written, fmt.Errorf("propagate product name: %w", err)
		}
	}

	return written, nil
}
