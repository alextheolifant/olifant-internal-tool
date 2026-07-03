// Command sync-metrics pulls daily SP campaign performance data from Amazon's
// Reporting API v3 for every active ads account and writes it into PostgreSQL
// and ClickHouse. It uses a two-phase batch approach persisted via
// ads_report_requests so the sync can resume cleanly after a restart.
//
// Usage:
//
//	sync-metrics                          # defaults: last 30 days
//	sync-metrics -start 2024-01-01 -end 2024-01-31
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/sync"
)

func main() {
	ctx := context.Background()

	// Date flags — default to last 30 days if omitted
	today := time.Now().UTC().Format("2006-01-02")
	defaultStart := time.Now().UTC().AddDate(0, 0, -30).Format("2006-01-02")
	startDate := flag.String("start", defaultStart, "report start date YYYY-MM-DD")
	endDate := flag.String("end", today, "report end date YYYY-MM-DD")
	flag.Parse()

	log.Printf("sync-metrics: range %s → %s", *startDate, *endDate)

	amazonClient := amazon.NewClient(
		requireEnv("ADS_CLIENT_ID"),
		requireEnv("ADS_CLIENT_SECRET"),
		requireEnv("ADS_REFRESH_TOKEN"),
	)

	writer, err := db.NewWriter(ctx, requireEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer writer.Close()

	chWriter, err := db.NewCHWriter(requireEnv("CLICKHOUSE_URL"))
	if err != nil {
		log.Fatalf("init clickhouse writer: %v", err)
	}

	accounts, err := writer.FetchActiveAccounts(ctx)
	if err != nil {
		log.Fatalf("fetch active accounts: %v", err)
	}
	log.Printf("found %d active accounts", len(accounts))

	orchestrator := sync.NewMetricsOrchestrator(amazonClient, writer, chWriter)
	result, err := orchestrator.SyncMetrics(ctx, accounts, *startDate, *endDate)
	if err != nil {
		log.Fatalf("sync failed: %v", err)
	}

	log.Printf("sync complete: ok=%d failed=%d skipped=%d records_written=%d",
		result.AccountsOK, result.AccountsFailed, result.AccountsSkipped, result.RecordsWritten)
	for region, r := range result.ByRegion {
		log.Printf("  region %s: ok=%d failed=%d records=%d",
			region, r.AccountsOK, r.AccountsFailed, r.RecordsWritten)
	}
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}
