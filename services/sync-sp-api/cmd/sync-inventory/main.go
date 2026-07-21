// Command sync-inventory pulls current FBA inventory levels from SP-API for
// every active seller account and writes it into sp_inventory. Direct
// paginated calls (nextToken) — no async report/poll cycle needed, unlike
// sync-sales.
//
// Usage:
//
//	sync-inventory
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

	accounts, err := writer.FetchActiveAccounts(ctx)
	if err != nil {
		log.Fatalf("fetch active accounts: %v", err)
	}
	log.Printf("found %d active accounts", len(accounts))

	orchestrator := sync.NewInventoryOrchestrator(
		writer,
		requireEnv("SP_API_CLIENT_ID"),
		requireEnv("SP_API_CLIENT_SECRET"),
		encryptionKey,
	)
	result := orchestrator.SyncInventory(ctx, accounts)

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
