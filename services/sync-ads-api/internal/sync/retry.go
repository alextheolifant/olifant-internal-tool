package sync

import (
	"context"
	"fmt"
	"log"
	"time"

	"olifant/sync-ads-api/internal/db"
)

const (
	syncTypeAdsMetricsRetry = "ads_metrics_retry"
	retryCap                = 3 // escalate to FAILED_PERMANENT after this many attempts
)

// RetryResult summarises one RetryFailedReports run.
type RetryResult struct {
	Retried         int // reports re-submitted to Amazon
	PermanentFailed int // reports escalated to FAILED_PERMANENT (cap reached)
	RecordsWritten  int // daily metric rows written by the Phase 2 poll
	AccountsFailed  int // accounts that failed again or timed out during Phase 2
}

// RetryFailedReports finds all terminal-failure report rows (TIMED_OUT, FAILED,
// CANCELLED), re-submits them to Amazon up to retryCap times, then runs a Phase 2
// poll loop to collect and write the results.
//
// Rows that have already been retried retryCap times are escalated to
// FAILED_PERMANENT instead of being re-submitted.
func (o *MetricsOrchestrator) RetryFailedReports(ctx context.Context) (*RetryResult, error) {
	result := &RetryResult{}

	logID, err := o.writer.CreateSyncLog(ctx, syncTypeAdsMetricsRetry)
	if err != nil {
		return nil, fmt.Errorf("create sync log: %w", err)
	}
	if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
		return nil, err
	}

	rows, err := o.writer.FetchRetryableReportRequests(ctx)
	if err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
		return nil, fmt.Errorf("fetch retryable requests: %w", err)
	}

	if len(rows) == 0 {
		log.Printf("retry-reports: no terminal rows found — nothing to do")
		_ = o.writer.CompleteSyncSuccess(ctx, logID, 0)
		return result, nil
	}

	log.Printf("retry-reports: found %d terminal report(s)", len(rows))

	token, err := o.tokens.Token(ctx)
	if err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
		return nil, fmt.Errorf("get token: %w", err)
	}

	for _, row := range rows {
		if row.RetryCount >= retryCap {
			reason := fmt.Sprintf("retry cap (%d) reached", retryCap)
			log.Printf("  account %s date %s–%s: %s — marking FAILED_PERMANENT",
				row.ProfileID, row.StartDate, row.EndDate, reason)
			_ = o.writer.MarkReportPermanentFailure(ctx, row.ID, reason)
			result.PermanentFailed++
			continue
		}

		baseURL, ok := regionBaseURL[row.Region]
		if !ok {
			log.Printf("  account %s: unknown region %q — skipping", row.ProfileID, row.Region)
			continue
		}

		reportID, err := o.amazonClient.RequestReport(ctx, token, baseURL, row.ProfileID, row.StartDate, row.EndDate)
		if err != nil {
			log.Printf("  account %s: RequestReport error: %v — leaving as-is", row.ProfileID, err)
			result.AccountsFailed++
			continue
		}

		newRetryCount := row.RetryCount + 1
		_, err = o.writer.ReplaceWithRetry(ctx, row.ID, db.ReportRequestInsert{
			AmazonAdsAccountID: row.AmazonAdsAccountID,
			SyncLogID:          logID,
			Region:             row.Region,
			ReportID:           reportID,
			StartDate:          row.StartDate,
			EndDate:            row.EndDate,
			RetryCount:         newRetryCount,
		})
		if err != nil {
			log.Printf("  account %s: ReplaceWithRetry error: %v", row.ProfileID, err)
			result.AccountsFailed++
			continue
		}

		log.Printf("  account %s (%s) date %s–%s: retry #%d submitted → report %s",
			row.ProfileID, row.Region, row.StartDate, row.EndDate, newRetryCount, reportID)
		result.Retried++
	}

	if result.Retried == 0 {
		log.Printf("retry-reports: no reports re-submitted (all at cap or API errors)")
		_ = o.writer.CompleteSyncSuccess(ctx, logID, 0)
		return result, nil
	}

	log.Printf("retry-reports: %d report(s) re-submitted, entering Phase 2 poll (max %s)",
		result.Retried, maxWait)

	metricsResult := &MetricsResult{ByRegion: make(map[string]regionMetricsResult)}
	deadline := time.Now().Add(maxWait)
	if err := o.pollPendingReports(ctx, deadline, metricsResult); err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, metricsResult.RecordsWritten, err.Error())
		return result, fmt.Errorf("phase 2 poll: %w", err)
	}

	result.RecordsWritten = metricsResult.RecordsWritten
	result.AccountsFailed += metricsResult.AccountsFailed

	_ = o.writer.CompleteSyncSuccess(ctx, logID, result.RecordsWritten)
	return result, nil
}
