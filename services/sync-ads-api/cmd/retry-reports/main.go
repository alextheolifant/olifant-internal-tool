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
	"encoding/base64"
	"log"
	"os"

	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/sync"
)

func main() {
	ctx := context.Background()

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

	orchestrator := sync.NewMetricsOrchestrator(clientID, clientSecret, encryptionKey, writer, chWriter)
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
