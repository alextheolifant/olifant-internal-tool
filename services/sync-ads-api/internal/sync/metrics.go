package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
)

const (
	syncTypeAdsMetrics = "ads_metrics"

	phase1Concurrency = 5               // max concurrent report requests in Phase 1
	phase2Concurrency = 10              // max concurrent poll checks per round
	pollInterval      = 20 * time.Second
	maxWait           = 16 * time.Minute // real reports take ~10 min; give 16 min headroom
)

// regionBaseURL maps the stored region string to the Amazon API base URL.
// Uses amazon.Regions as the canonical source so the map only lives in one place.
var regionBaseURL = func() map[string]string {
	m := make(map[string]string, len(amazon.Regions))
	for _, r := range amazon.Regions {
		m[r.Name] = r.BaseURL
	}
	return m
}()

// MetricsResult summarises one syncMetrics run.
type MetricsResult struct {
	AccountsOK     int
	AccountsFailed int
	AccountsSkipped int // NULL/invalid region
	RecordsWritten int
	ByRegion       map[string]regionMetricsResult
}

type regionMetricsResult struct {
	AccountsOK     int
	AccountsFailed int
	RecordsWritten int
}

// MetricsOrchestrator drives the two-phase metrics sync.
type MetricsOrchestrator struct {
	tokens       *amazon.TokenManager
	amazonClient *amazon.Client
	writer       *db.Writer
	chWriter     *db.CHWriter
}

func NewMetricsOrchestrator(c *amazon.Client, w *db.Writer, ch *db.CHWriter) *MetricsOrchestrator {
	return &MetricsOrchestrator{
		tokens:       amazon.NewTokenManager(c),
		amazonClient: c,
		writer:       w,
		chWriter:     ch,
	}
}

// SyncMetrics is the single entry point for all metrics syncs.
// startDate/endDate are "YYYY-MM-DD". Region handling is internal.
//
// Call patterns — same function, different ranges chosen by the caller:
//   Initial 30-day backfill (today, manual):   SyncMetrics(accounts, today-30, today)
//   Today refresh (future, every 2-4 h):       SyncMetrics(accounts, today, today)
//   Daily catch-up for attribution drift:       SyncMetrics(accounts, today-7, today)
//   Ad-hoc re-sync of any specific range:       SyncMetrics(accounts, anyStart, anyEnd)
//
// TODO: Temporal will call this on schedules — e.g. every 2-4 h with a 1-day
// range for freshness, and once daily with a 7-day range for attribution corrections.
func (o *MetricsOrchestrator) SyncMetrics(
	ctx context.Context,
	accounts []db.AdsAccount,
	startDate, endDate string,
) (*MetricsResult, error) {
	result := &MetricsResult{ByRegion: make(map[string]regionMetricsResult)}

	// ── Phase 1: submit report requests for every account concurrently ────────
	type phase1Out struct {
		account db.AdsAccount
		skipped bool
		err     error
	}

	sem := make(chan struct{}, phase1Concurrency)
	outCh := make(chan phase1Out, len(accounts))
	var wg sync.WaitGroup

	log.Printf("Phase 1: submitting report requests for %d accounts (start=%s end=%s)",
		len(accounts), startDate, endDate)

	for _, acct := range accounts {
		wg.Add(1)
		go func(a db.AdsAccount) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out := phase1Out{account: a}

			// Defensive: skip accounts with no valid region
			baseURL, ok := regionBaseURL[a.Region]
			if !ok || a.Region == "" {
				log.Printf("WARN: account %s has invalid region %q — skipping", a.ProfileID, a.Region)
				out.skipped = true
				outCh <- out
				return
			}

			// Check for an existing non-terminal request (from a previous crashed run)
			_, existingReportID, found, err := o.writer.FindActiveReportRequest(ctx, a.ID, startDate, endDate)
			if err != nil {
				out.err = fmt.Errorf("find existing request: %w", err)
				outCh <- out
				return
			}
			if found {
				log.Printf("account %s (%s): resuming existing report %s", a.ProfileID, a.Region, existingReportID)
				outCh <- out
				return
			}

			// Get (or refresh) access token — same token works across all regions
			token, err := o.tokens.Token(ctx)
			if err != nil {
				out.err = fmt.Errorf("get token: %w", err)
				outCh <- out
				return
			}

			// Create sync_log entry for this account
			logID, err := o.writer.CreateAccountSyncLog(ctx, syncTypeAdsMetrics, a.ID)
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

			// Submit the report request to Amazon
			reportID, err := o.amazonClient.RequestReport(ctx, token, baseURL, a.ProfileID, startDate, endDate)
			if err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("request report: %w", err)
				outCh <- out
				return
			}

			// Persist the in-flight request so Phase 2 can resume after a crash
			if _, err := o.writer.InsertReportRequest(ctx, db.ReportRequestInsert{
				AmazonAdsAccountID: a.ID,
				SyncLogID:          logID,
				Region:             a.Region,
				ReportID:           reportID,
				StartDate:          startDate,
				EndDate:            endDate,
			}); err != nil {
				_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
				out.err = fmt.Errorf("insert report request row: %w", err)
				outCh <- out
				return
			}

			log.Printf("account %s (%s): submitted report %s", a.ProfileID, a.Region, reportID)
			outCh <- out
		}(acct)
	}

	wg.Wait()
	close(outCh)

	// Tally Phase 1 results
	for out := range outCh {
		r := result.ByRegion[out.account.Region]
		if out.skipped {
			result.AccountsSkipped++
			continue
		}
		if out.err != nil {
			log.Printf("account %s: Phase 1 error: %v", out.account.ProfileID, out.err)
			result.AccountsFailed++
			r.AccountsFailed++
			result.ByRegion[out.account.Region] = r
		}
	}

	// ── Phase 2: poll all pending rows from DB until terminal or timeout ──────
	log.Printf("Phase 2: polling until all reports complete or %s elapses", maxWait)
	deadline := time.Now().Add(maxWait)
	return result, o.pollPendingReports(ctx, deadline, result)
}

// pollPendingReports reads PENDING/PROCESSING rows from ads_report_requests each round,
// polls Amazon for their status, writes completed data, and sleeps between rounds until
// all rows are terminal or deadline is reached. Mutates result in-place.
func (o *MetricsOrchestrator) pollPendingReports(ctx context.Context, deadline time.Time, result *MetricsResult) error {
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
			log.Printf("Phase 2: timeout — %d report(s) marked TIMED_OUT", n)
			result.AccountsFailed += n
			break
		}

		log.Printf("Phase 2: %d report(s) still pending, checking...", len(pending))

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

				baseURL, ok := regionBaseURL[r.Region]
				if !ok {
					pr.err = fmt.Errorf("unknown region %q", r.Region)
					pollCh <- pr
					return
				}

				token, err := o.tokens.Token(ctx)
				if err != nil {
					pr.err = fmt.Errorf("get token: %w", err)
					pollCh <- pr
					return
				}

				status, err := o.amazonClient.GetReportStatus(ctx, token, baseURL, r.ProfileID, r.ReportID)
				if err != nil {
					pr.err = fmt.Errorf("poll status: %w", err)
					pollCh <- pr
					return
				}

				switch status.Status {
				case "COMPLETED":
					_ = o.writer.TouchReportRequest(ctx, r.ID, "COMPLETED")
					written, err := o.processCompleted(ctx, r, status.URL)
					if err != nil {
						_ = o.writer.MarkReportTerminal(ctx, r.ID, "FAILED", err.Error())
						if r.SyncLogID != "" {
							_ = o.writer.CompleteSyncFailure(ctx, r.SyncLogID, 0, err.Error())
						}
						pr.err = err
					} else {
						_ = o.writer.DeleteReportRequest(ctx, r.ID)
						if r.SyncLogID != "" {
							_ = o.writer.CompleteSyncSuccess(ctx, r.SyncLogID, written)
						}
						pr.written = written
					}

				case "FAILED", "CANCELLED":
					msg := status.FailureReason
					if msg == "" {
						msg = status.Status
					}
					_ = o.writer.MarkReportTerminal(ctx, r.ID, status.Status, msg)
					if r.SyncLogID != "" {
						_ = o.writer.CompleteSyncFailure(ctx, r.SyncLogID, 0, msg)
					}
					pr.err = fmt.Errorf("report %s: %s", status.Status, msg)

				default: // PENDING / PROCESSING
					_ = o.writer.TouchReportRequest(ctx, r.ID, status.Status)
					log.Printf("  account %s: report %s still %s", r.ProfileID, r.ReportID, status.Status)
				}

				pollCh <- pr
			}(row)
		}

		pollWg.Wait()
		close(pollCh)

		for pr := range pollCh {
			r := result.ByRegion[pr.row.Region]
			if pr.err != nil {
				log.Printf("account %s: error: %v", pr.row.ProfileID, pr.err)
				result.AccountsFailed++
				r.AccountsFailed++
			} else if pr.written > 0 {
				result.AccountsOK++
				result.RecordsWritten += pr.written
				r.AccountsOK++
				r.RecordsWritten += pr.written
				log.Printf("account %s (%s): wrote %d daily rows", pr.row.ProfileID, pr.row.Region, pr.written)
			}
			result.ByRegion[pr.row.Region] = r
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

// processCompleted downloads the report, parses it, and writes rows to
// PostgreSQL and ClickHouse. Returns the number of daily metric rows written.
func (o *MetricsOrchestrator) processCompleted(
	ctx context.Context,
	row db.PendingReportRequest,
	downloadURL string,
) (int, error) {
	records, err := o.amazonClient.DownloadReport(ctx, downloadURL)
	if err != nil {
		return 0, fmt.Errorf("download report: %w", err)
	}

	campaignMap, err := o.writer.FetchCampaignUUIDs(ctx, row.AmazonAdsAccountID)
	if err != nil {
		return 0, fmt.Errorf("fetch campaign uuids: %w", err)
	}

	// Delete existing ClickHouse rows for this account+date range before inserting.
	if err := o.chWriter.DeleteMetrics(ctx, row.ProfileID, row.StartDate, row.EndDate); err != nil {
		return 0, fmt.Errorf("delete ch metrics: %w", err)
	}

	salesCol := "sales" + amazon.AttrWindow
	purchasesCol := "purchases" + amazon.AttrWindow

	var chRows []db.CHRow
	written := 0

	for _, rec := range records {
		amazonCampaignID, err := jsonString(rec, "campaignId")
		if err != nil {
			continue
		}

		pgUUID, ok := campaignMap[amazonCampaignID]
		if !ok {
			log.Printf("WARN: account %s: campaign %s not in campaigns table — skipping",
				row.ProfileID, amazonCampaignID)
			continue
		}

		date, _        := jsonString(rec, "date")
		impressions, _ := jsonInt64(rec, "impressions")
		clicks, _      := jsonInt64(rec, "clicks")
		cost, _        := jsonFloat64(rec, "cost")
		sales, _       := jsonFloat64(rec, salesCol)
		purchases, _   := jsonInt64(rec, purchasesCol)
		cpc, _         := jsonFloat64(rec, "costPerClick")
		ctr, _         := jsonFloat64(rec, "clickThroughRate")

		// ACoS and ROAS are always calculated locally (not requested from API)
		acos := 0.0
		if sales > 0 {
			acos = (cost / sales) * 100
		}
		roas := 0.0
		if cost > 0 {
			roas = sales / cost
		}

		if err := o.writer.UpsertMetric(ctx, db.MetricUpsert{
			CampaignUUID: pgUUID,
			Date:         date,
			Impressions:  impressions,
			Clicks:       clicks,
			Spend:        cost,
			Sales:        sales,
			Orders:       purchases,
			ACoS:         acos,
			ROAS:         roas,
			CPC:          cpc,
			CTR:          ctr,
		}); err != nil {
			return written, fmt.Errorf("upsert metric: %w", err)
		}

		chRows = append(chRows, db.CHRow{
			AccountID:   row.ProfileID,
			CampaignID:  amazonCampaignID,
			Date:        date,
			Impressions: impressions,
			Clicks:      clicks,
			Spend:       cost,
			Sales:       sales,
			Orders:      purchases,
			ACoS:        acos,
			ROAS:        roas,
			CTR:         ctr,
			CPC:         cpc,
		})
		written++
	}

	if err := o.chWriter.InsertMetrics(ctx, chRows); err != nil {
		return written, fmt.Errorf("insert ch metrics: %w", err)
	}

	return written, nil
}

// ── JSON extraction helpers ───────────────────────────────────────────────────

func jsonString(m map[string]json.RawMessage, key string) (string, error) {
	v, ok := m[key]
	if !ok {
		return "", fmt.Errorf("key %q missing", key)
	}
	// Try quoted string first
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		return s, nil
	}
	// Amazon returns numeric IDs (e.g. campaignId) as bare numbers, not strings.
	// Return the raw token so it matches what's stored in the DB.
	raw := strings.TrimSpace(string(v))
	if raw == "" || raw == "null" {
		return "", fmt.Errorf("key %q is null", key)
	}
	return raw, nil
}

func jsonFloat64(m map[string]json.RawMessage, key string) (float64, error) {
	v, ok := m[key]
	if !ok {
		return 0, fmt.Errorf("key %q missing", key)
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(string(v)), 64)
	if err != nil {
		// Some fields may be quoted strings in the JSON
		var s string
		if json.Unmarshal(v, &s) == nil {
			return strconv.ParseFloat(s, 64)
		}
		return 0, err
	}
	return f, nil
}

func jsonInt64(m map[string]json.RawMessage, key string) (int64, error) {
	v, ok := m[key]
	if !ok {
		return 0, fmt.Errorf("key %q missing", key)
	}
	// Try numeric first
	n, err := strconv.ParseInt(strings.TrimSpace(string(v)), 10, 64)
	if err == nil {
		return n, nil
	}
	// Fall back: quoted string
	var s string
	if json.Unmarshal(v, &s) == nil {
		if n2, err2 := strconv.ParseInt(s, 10, 64); err2 == nil {
			return n2, nil
		}
		// Could be a float (e.g. "1.0")
		if f, err3 := strconv.ParseFloat(s, 64); err3 == nil {
			return int64(f), nil
		}
	}
	return 0, err
}
