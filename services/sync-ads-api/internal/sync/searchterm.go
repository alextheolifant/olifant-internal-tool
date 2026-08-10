package sync

import (
	"context"
	"encoding/json"
	"log"

	"olifant/sync-ads-api/internal/db"
)

// processSearchTermReport parses one account's downloaded spSearchTerm
// records and upserts them into search_term_metrics_daily. Column names are
// unverified against a real report — see searchTermReportColumns in the
// amazon package. keywordId/matchType are optional: auto/product-targeting
// search terms have no keyword.
func processSearchTermReport(
	ctx context.Context,
	o *MetricsOrchestrator,
	row db.PendingReportRequest,
	records []map[string]json.RawMessage,
) (int, error) {
	written := 0

	for _, rec := range records {
		date, err := jsonString(rec, "date")
		if err != nil {
			continue
		}
		campaignID, err := jsonString(rec, "campaignId")
		if err != nil {
			continue
		}
		adGroupID, err := jsonString(rec, "adGroupId")
		if err != nil {
			continue
		}
		searchTerm, err := jsonString(rec, "searchTerm")
		if err != nil {
			continue
		}

		impressions, _ := jsonInt64(rec, "impressions")
		clicks, _ := jsonInt64(rec, "clicks")
		cost, _ := jsonFloat64(rec, "cost")
		sales7d, _ := jsonFloat64(rec, "sales7d")
		sales14d, _ := jsonFloat64(rec, "sales14d")
		orders7d, _ := jsonInt64(rec, "purchases7d")
		orders14d, _ := jsonInt64(rec, "purchases14d")
		units7d, _ := jsonInt64(rec, "unitsSoldClicks7d")
		units14d, _ := jsonInt64(rec, "unitsSoldClicks14d")

		if err := o.writer.UpsertSearchTermMetric(ctx, db.SearchTermMetricUpsert{
			AmazonAdsAccountID: row.AmazonAdsAccountID,
			Date:               date,
			SearchTerm:         searchTerm,
			KeywordID:          jsonStringOptional(rec, "keywordId"),
			CampaignID:         campaignID,
			AdGroupID:          adGroupID,
			MatchType:          jsonStringOptional(rec, "matchType"),
			Impressions:        impressions,
			Clicks:             clicks,
			Cost:               cost,
			Sales7d:            sales7d,
			Sales14d:           sales14d,
			Orders7d:           orders7d,
			Orders14d:          orders14d,
			Units7d:            units7d,
			Units14d:           units14d,
		}); err != nil {
			// Log and continue — one malformed row must not drop the rest of
			// this report, and must not force a full resubmission via retry-reports.
			log.Printf("WARN: account %s: upsert search term metric failed, skipping row: %v", row.ProfileID, err)
			continue
		}
		written++
	}

	return written, nil
}
