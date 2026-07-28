package main

import (
	"context"
	"encoding/base64"
	"log"
	"os"

	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/sync"
)

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

func main() {
	ctx := context.Background()

	clientID := requireEnv("ADS_CLIENT_ID")
	clientSecret := requireEnv("ADS_CLIENT_SECRET")
	encryptionKey := decodeKey(requireEnv("SP_TOKEN_ENCRYPTION_KEY"))
	databaseURL := requireEnv("DATABASE_URL")

	writer, err := db.NewWriter(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer writer.Close()

	orchestrator := sync.NewCampaignOrchestrator(clientID, clientSecret, encryptionKey, writer)

	log.Println("[campaigns] starting SP campaign sync")
	result, err := orchestrator.RunCampaignSync(ctx)
	if err != nil {
		log.Fatalf("[campaigns] sync failed: %v", err)
	}

	log.Printf("[campaigns] done — accounts: %d processed, %d failed | campaigns upserted: %d",
		result.AccountsProcessed, result.AccountsFailed, result.CampaignsUpserted)
}
