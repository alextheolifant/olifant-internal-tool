// Command sync-sales pulls GET_SALES_AND_TRAFFIC_REPORT data from SP-API for
// every active seller account and writes it into sp_sales_daily. Two-phase
// batch approach persisted via sp_report_requests, so the sync can resume
// cleanly after a restart — same design as sync-ads-api's sync-metrics.
//
// Usage:
//
//	sync-sales                          # defaults: last 30 days
//	sync-sales -start 2024-01-01 -end 2024-01-31
package main

import (
	"context"
	"encoding/base64"
	"flag"
	"log"
	"os"
	"time"

	"olifant/sync-sp-api/internal/db"
	"olifant/sync-sp-api/internal/sync"
)

func main() {
	ctx := context.Background()

	today := time.Now().UTC().Format("2006-01-02")
	defaultStart := time.Now().UTC().AddDate(0, 0, -30).Format("2006-01-02")
	startDate := flag.String("start", defaultStart, "report start date YYYY-MM-DD")
	endDate := flag.String("end", today, "report end date YYYY-MM-DD")
	flag.Parse()

	log.Printf("sync-sales: range %s → %s", *startDate, *endDate)

	encryptionKey := decodeKey(requireEnv("SP_TOKEN_ENCRYPTION_KEY"))

	writer, err := db.NewWriter(ctx, requireEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer writer.Close()

	accounts, err := writer.FetchActiveAccounts(ctx)
	if err != nil {
		log.Fatalf("fetch active accounts: %v", err)
	}
	log.Printf("found %d active accounts", len(accounts))

	orchestrator := sync.NewSalesOrchestrator(
		writer,
		requireEnv("SP_API_CLIENT_ID"),
		requireEnv("SP_API_CLIENT_SECRET"),
		encryptionKey,
	)
	result, err := orchestrator.SyncSales(ctx, accounts, *startDate, *endDate)
	if err != nil {
		log.Fatalf("sync failed: %v", err)
	}

	log.Printf("sync complete: ok=%d failed=%d records_written=%d",
		result.AccountsOK, result.AccountsFailed, result.RecordsWritten)
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
