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
	"encoding/base64"
	"flag"
	"log"
	"os"
	"time"

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

	clientID := requireEnv("ADS_CLIENT_ID")
	clientSecret := requireEnv("ADS_CLIENT_SECRET")
	encryptionKey := decodeKey(requireEnv("SP_TOKEN_ENCRYPTION_KEY"))

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

	orchestrator := sync.NewMetricsOrchestrator(clientID, clientSecret, encryptionKey, writer, chWriter)
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

func decodeKey(b64 string) []byte {
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		log.Fatalf("SP_TOKEN_ENCRYPTION_KEY is not valid base64: %v", err)
	}
	if len(key) != 32 {
		log.Fatalf("SP_TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key
}
