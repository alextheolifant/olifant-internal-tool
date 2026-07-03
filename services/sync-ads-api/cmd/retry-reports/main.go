// Command retry-reports re-submits Amazon Advertising report requests that ended
// in a terminal failure state (TIMED_OUT, FAILED, CANCELLED). Reports that have
// already been retried 3 times are escalated to FAILED_PERMANENT instead.
//
// Usage:
//
//	retry-reports
package main

import (
	"context"
	"log"
	"os"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/sync"
)

func main() {
	ctx := context.Background()

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

	orchestrator := sync.NewMetricsOrchestrator(amazonClient, writer, chWriter)
	result, err := orchestrator.RetryFailedReports(ctx)
	if err != nil {
		log.Fatalf("retry failed: %v", err)
	}

	log.Printf("retry-reports complete: retried=%d permanent_failed=%d records_written=%d accounts_failed=%d",
		result.Retried, result.PermanentFailed, result.RecordsWritten, result.AccountsFailed)
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}
