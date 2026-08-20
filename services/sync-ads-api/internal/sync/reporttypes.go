package sync

import (
	"context"
	"encoding/json"
	"fmt"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
)

// Report type registry keys — also the sync_logs.sync_type suffix and the
// ads_report_requests.report_type value persisted for each request. Adding a
// fourth Sponsored Products report family (or an SB/SD variant later) means
// adding one constant + one reportTypeRegistry entry below; the request/poll/
// download machinery in SyncMetrics/pollPendingReports never changes.
const (
	ReportTypeCampaigns  = "campaigns"
	ReportTypeSearchTerm = "searchTerm"
	ReportTypeTargeting  = "targeting"
)

// reportTypeConfig bundles the Amazon-side request shape (embedded from the
// amazon package) with how to turn one account's downloaded records into
// rows in this report type's table — the two things that differ between
// report families. Everything else (submit, poll, backoff, download,
// ads_report_requests bookkeeping) is shared.
type reportTypeConfig struct {
	amazon.ReportRequestConfig
	syncType string // sync_logs.sync_type enum value for this report family

	// process parses one account's downloaded records for this report type
	// and upserts them, returning the number of rows written.
	process func(ctx context.Context, o *MetricsOrchestrator, row db.PendingReportRequest, records []map[string]json.RawMessage) (int, error)
}

var reportTypeRegistry = map[string]reportTypeConfig{
	ReportTypeCampaigns: {
		ReportRequestConfig: amazon.CampaignReportConfig,
		syncType:            "ads_metrics",
		process:             processCampaignReport,
	},
	ReportTypeSearchTerm: {
		ReportRequestConfig: amazon.SearchTermReportConfig,
		syncType:            "ads_search_term",
		process:             processSearchTermReport,
	},
	ReportTypeTargeting: {
		ReportRequestConfig: amazon.TargetingReportConfig,
		syncType:            "ads_targeting",
		process:             processTargetingReport,
	},
}

func reportTypeConfigFor(key string) (reportTypeConfig, error) {
	cfg, ok := reportTypeRegistry[key]
	if !ok {
		return reportTypeConfig{}, fmt.Errorf("unknown report type %q", key)
	}
	return cfg, nil
}
