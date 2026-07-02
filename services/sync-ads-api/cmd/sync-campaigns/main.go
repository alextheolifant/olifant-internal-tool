package main

import (
	"context"
	"log"
	"os"

	"olifant/sync-ads-api/internal/amazon"
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

func main() {
	ctx := context.Background()

	clientID     := requireEnv("ADS_CLIENT_ID")
	clientSecret := requireEnv("ADS_CLIENT_SECRET")
	refreshToken := requireEnv("ADS_REFRESH_TOKEN")
	databaseURL  := requireEnv("DATABASE_URL")

	amazonClient := amazon.NewClient(clientID, clientSecret, refreshToken)

	writer, err := db.NewWriter(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer writer.Close()

	orchestrator := sync.NewCampaignOrchestrator(amazonClient, writer)

	log.Println("[campaigns] starting SP campaign sync")
	result, err := orchestrator.RunCampaignSync(ctx)
	if err != nil {
		log.Fatalf("[campaigns] sync failed: %v", err)
	}

	log.Printf("[campaigns] done — accounts: %d processed, %d failed | campaigns upserted: %d",
		result.AccountsProcessed, result.AccountsFailed, result.CampaignsUpserted)
}
