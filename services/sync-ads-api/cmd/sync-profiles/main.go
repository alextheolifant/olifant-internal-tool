// Command sync-profiles is a one-shot CLI that discovers every Amazon
// Advertising profile accessible to the configured developer account and
// upserts the corresponding clients/amazon_ads_accounts rows. It will later
// be wrapped as a Temporal activity; for now it's triggered manually.
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
		log.Fatalf("connect to database: %v", err)
	}
	defer writer.Close()

	log.Println("starting ads profiles sync")

	result, err := sync.NewOrchestrator(amazonClient, writer).RunProfilesSync(ctx)
	if err != nil {
		log.Fatalf("sync failed: %v", err)
	}

	log.Printf(
		"sync complete: profiles_fetched=%d accounts_upserted=%d clients_created=%d",
		result.ProfilesFetched, result.AccountsUpserted, result.ClientsCreated,
	)
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
	}
	return v
}
