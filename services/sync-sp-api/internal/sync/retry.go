package sync

import (
	"context"
	"fmt"
	"log"
	"time"

	"olifant/sync-sp-api/internal/amazon"
	"olifant/sync-sp-api/internal/db"
)

// Mirrors sync-ads-api/internal/sync/retry.go's mechanism exactly — see that
// file for the fuller rationale. Adapted here only where sp-api's shape
// genuinely differs: tokens are per-seller-account (accountContext, built
// fresh via buildContexts) rather than per-manager-account, and
// RequestReport takes a Region + reportType + marketplaceID instead of a
// baseURL + ReportRequestConfig.
const (
	syncTypeSpOrdersRetry = "sp_orders_retry"
	retryCap              = 3 // escalate to FAILED_PERMANENT after this many attempts
)

// RetryResult summarises one RetryFailedReports run.
type RetryResult struct {
	Retried         int // reports re-submitted to Amazon
	PermanentFailed int // reports escalated to FAILED_PERMANENT (cap reached)
	RecordsWritten  int // daily sales rows written by the Phase 2 poll
	AccountsFailed  int // accounts that failed again or timed out during Phase 2
}

// RetryFailedReports finds all terminal-failure report rows (FATAL,
// CANCELLED), re-submits them to Amazon up to retryCap times, then runs a
// Phase 2 poll loop to collect and write the results.
//
// Rows that have already been retried retryCap times are escalated to
// FAILED_PERMANENT instead of being re-submitted.
func (o *SalesOrchestrator) RetryFailedReports(ctx context.Context) (*RetryResult, error) {
	result := &RetryResult{}

	logID, err := o.writer.CreateSyncLog(ctx, syncTypeSpOrdersRetry)
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

	// Built fresh here rather than reused from a prior SyncSales call — this
	// is a separate process invocation in practice (cmd/sync-sales vs
	// cmd/retry-reports), same convention as buildTokenManagers on the
	// ads-api side.
	accounts, err := o.writer.FetchActiveAccounts(ctx)
	if err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
		return nil, fmt.Errorf("fetch active accounts: %w", err)
	}
	contexts := o.buildContexts(accounts)

	for _, row := range rows {
		if row.RetryCount >= retryCap {
			reason := fmt.Sprintf("retry cap (%d) reached", retryCap)
			log.Printf("  account %s date %s–%s: %s — marking FAILED_PERMANENT",
				row.SellingPartnerID, row.StartDate, row.EndDate, reason)
			_ = o.writer.MarkReportPermanentFailure(ctx, row.ID, reason)
			result.PermanentFailed++
			continue
		}

		ac, ok := contexts[row.AmazonSPAccountID]
		if !ok {
			log.Printf("  account %s: no context (inactive, or refresh token decrypt failed earlier) — skipping", row.SellingPartnerID)
			result.AccountsFailed++
			continue
		}

		token, err := ac.tokens.Token(ctx)
		if err != nil {
			log.Printf("  account %s: get token error: %v — skipping", row.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		reportID, err := ac.client.RequestReport(ctx, token, ac.region, amazon.SalesReportType, row.Marketplace, row.StartDate, row.EndDate)
		if err != nil {
			log.Printf("  account %s: RequestReport error: %v — leaving as-is", row.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		newRetryCount := row.RetryCount + 1
		_, err = o.writer.ReplaceWithRetry(ctx, row.ID, db.ReportRequestInsert{
			AmazonSPAccountID: row.AmazonSPAccountID,
			SyncLogID:         logID,
			Region:            row.Region,
			ReportID:          reportID,
			StartDate:         row.StartDate,
			EndDate:           row.EndDate,
			RetryCount:        newRetryCount,
		})
		if err != nil {
			log.Printf("  account %s: ReplaceWithRetry error: %v", row.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		log.Printf("  account %s (%s) date %s–%s: retry #%d submitted → report %s",
			row.SellingPartnerID, row.Region, row.StartDate, row.EndDate, newRetryCount, reportID)
		result.Retried++
	}

	if result.Retried == 0 {
		log.Printf("retry-reports: no reports re-submitted (all at cap or API errors)")
		_ = o.writer.CompleteSyncSuccess(ctx, logID, 0)
		return result, nil
	}

	log.Printf("retry-reports: %d report(s) re-submitted, entering Phase 2 poll (max %s)",
		result.Retried, maxWait)

	salesResult := &SalesResult{}
	deadline := time.Now().Add(maxWait)
	if err := o.pollPendingReports(ctx, deadline, salesResult, contexts); err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, salesResult.RecordsWritten, err.Error())
		return result, fmt.Errorf("phase 2 poll: %w", err)
	}

	result.RecordsWritten = salesResult.RecordsWritten
	result.AccountsFailed += salesResult.AccountsFailed

	_ = o.writer.CompleteSyncSuccess(ctx, logID, result.RecordsWritten)
	return result, nil
}
