// Command retry-reports re-submits SP-API sales report requests that ended in
// a terminal failure state (FATAL, CANCELLED). Reports that have already
// been retried 3 times are escalated to FAILED_PERMANENT instead — same
// mechanism as sync-ads-api's retry-reports, adapted for sp-api's per-seller-
// account tokens and status vocabulary.
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

	"olifant/sync-sp-api/internal/db"
	"olifant/sync-sp-api/internal/sync"
)

func main() {
	ctx := context.Background()

	encryptionKey := decodeKey(requireEnv("SP_TOKEN_ENCRYPTION_KEY"))

	writer, err := db.NewWriter(ctx, requireEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer writer.Close()

	orchestrator := sync.NewSalesOrchestrator(
		writer,
		requireEnv("SP_API_CLIENT_ID"),
		requireEnv("SP_API_CLIENT_SECRET"),
		encryptionKey,
	)
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
