package sync

import (
	"context"
	"encoding/json"
	"log"

	"olifant/sync-ads-api/internal/db"
)

// processTargetingReport parses one account's downloaded spTargeting records
// and upserts them into target_metrics_daily. Column names verified against
// a real report (see targetingReportColumns in the amazon package) — Amazon
// has no "targetId" field for this report type, it reuses "keywordId" as the
// identifier even for product-targeting expressions. matchType is optional:
// product targets have no match type (only keyword targets do).
func processTargetingReport(
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
		targetID, err := jsonString(rec, "keywordId")
		if err != nil {
			continue
		}
		expression, err := jsonString(rec, "targeting")
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

		if err := o.writer.UpsertTargetMetric(ctx, db.TargetMetricUpsert{
			AmazonAdsAccountID: row.AmazonAdsAccountID,
			Date:               date,
			TargetID:           targetID,
			Expression:         expression,
			MatchType:          jsonStringOptional(rec, "matchType"),
			CampaignID:         campaignID,
			AdGroupID:          adGroupID,
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
			log.Printf("WARN: account %s: upsert target metric failed, skipping row: %v", row.ProfileID, err)
			continue
		}
		written++
	}

	return written, nil
}
