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

const (
	syncTypeSpOrders = "sp_orders"

	phase1Concurrency = 5
	phase2Concurrency = 10
	pollInterval      = 5 * time.Minute
	maxWait           = 16 * time.Minute // real reports take ~10 min; give 16 min headroom
)

// SalesResult summarises one SyncSales run.
type SalesResult struct {
	AccountsOK     int
	AccountsFailed int
	RecordsWritten int
}

// accountContext bundles the per-account amazon.Client + TokenManager + region
// needed across both phases. Refresh tokens are per-seller (unlike the Ads
// API's single app-level token), so each account gets its own client/manager.
type accountContext struct {
	account db.SpAccount
	client  *amazon.Client
	tokens  *amazon.TokenManager
	region  amazon.Region
}

// SalesOrchestrator drives the two-phase GET_SALES_AND_TRAFFIC_REPORT sync.
type SalesOrchestrator struct {
	writer          *db.Writer
	lwaClientID     string
	lwaClientSecret string
	encryptionKey   []byte
}

func NewSalesOrchestrator(w *db.Writer, lwaClientID, lwaClientSecret string, encryptionKey []byte) *SalesOrchestrator {
	return &SalesOrchestrator{
		writer:          w,
		lwaClientID:     lwaClientID,
		lwaClientSecret: lwaClientSecret,
		encryptionKey:   encryptionKey,
	}
}

func (o *SalesOrchestrator) buildContexts(accounts []db.SpAccount) map[string]*accountContext {
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

// SyncSales is the single entry point for the sales/traffic sync.
// startDate/endDate are "YYYY-MM-DD".
func (o *SalesOrchestrator) SyncSales(ctx context.Context, accounts []db.SpAccount, startDate, endDate string) (*SalesResult, error) {
	result := &SalesResult{}
	contexts := o.buildContexts(accounts)

	// ── Phase 1: submit report requests for every account concurrently ────────
	type phase1Out struct {
		accountID string
		err       error
	}

	sem := make(chan struct{}, phase1Concurrency)
	outCh := make(chan phase1Out, len(accounts))
	var wg sync.WaitGroup

	log.Printf("Phase 1: submitting sales report requests for %d accounts (start=%s end=%s)",
		len(contexts), startDate, endDate)

	for _, ac := range contexts {
		wg.Add(1)
		go func(ac *accountContext) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out := phase1Out{accountID: ac.account.ID}
			a := ac.account

			_, existingReportID, found, err := o.writer.FindActiveReportRequest(ctx, a.ID, startDate, endDate)
			if err != nil {
				out.err = fmt.Errorf("find existing request: %w", err)
				outCh <- out
				return
			}
			if found {
				log.Printf("account %s (%s): resuming existing report %s", a.SellingPartnerID, a.Region, existingReportID)
				outCh <- out
				return
			}

			logID, err := o.writer.CreateAccountSyncLog(ctx, syncTypeSpOrders, a.ID)
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

			reportID, err := ac.client.RequestReport(ctx, token, ac.region, a.Marketplace, startDate, endDate)
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
				StartDate:         startDate,
				EndDate:           endDate,
			}); err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("insert report request row: %w", err)
				outCh <- out
				return
			}

			log.Printf("account %s (%s): submitted sales report %s", a.SellingPartnerID, a.Region, reportID)
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
	log.Printf("Phase 2: polling until all sales reports complete or %s elapses", maxWait)
	deadline := time.Now().Add(maxWait)
	return result, o.pollPendingReports(ctx, deadline, result, contexts)
}

func (o *SalesOrchestrator) pollPendingReports(ctx context.Context, deadline time.Time, result *SalesResult, contexts map[string]*accountContext) error {
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

		log.Printf("Phase 2: %d sales report(s) still pending, checking...", len(pending))

		type pollResult struct {
			row     db.PendingReportRequest
			written int
			err     error
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
			} else if pr.written > 0 {
				result.AccountsOK++
				result.RecordsWritten += pr.written
				log.Printf("account %s: wrote %d daily sales rows", pr.row.AmazonSPAccountID, pr.written)
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

// processCompleted downloads and parses the report, then upserts one
// sp_sales_daily row per date present in the file.
func (o *SalesOrchestrator) processCompleted(ctx context.Context, ac *accountContext, row db.PendingReportRequest, reportDocumentID string) (int, error) {
	token, err := ac.tokens.Token(ctx)
	if err != nil {
		return 0, fmt.Errorf("get token: %w", err)
	}

	records, err := ac.client.DownloadReport(ctx, token, ac.region, reportDocumentID)
	if err != nil {
		return 0, fmt.Errorf("download report: %w", err)
	}

	written := 0
	for _, rec := range records {
		date, ok := rec["date"]
		if !ok || date == "" {
			continue
		}

		if err := o.writer.UpsertSalesDaily(ctx, db.SalesDailyUpsert{
			AmazonSPAccountID: row.AmazonSPAccountID,
			Date:              date,
			TotalSales:        amazon.TSVFloat(rec, "orderedProductSales"),
			UnitsOrdered:      amazon.TSVInt(rec, "unitsOrdered"),
			Orders:            amazon.TSVInt(rec, "totalOrderItems"),
		}); err != nil {
			return written, fmt.Errorf("upsert sales daily: %w", err)
		}
		written++
	}

	return written, nil
}
