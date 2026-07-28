// Command sync-profiles is a one-shot CLI that discovers every Amazon
// Advertising profile accessible to the configured developer account and
// upserts the corresponding clients/amazon_ads_accounts rows. It will later
// be wrapped as a Temporal activity; for now it's triggered manually.
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
		log.Fatalf("connect to database: %v", err)
	}
	defer writer.Close()

	log.Println("starting ads profiles sync")

	result, err := sync.NewOrchestrator(clientID, clientSecret, encryptionKey, writer).RunProfilesSync(ctx)
	if err != nil {
		log.Fatalf("sync failed: %v", err)
	}

	log.Printf(
		"sync complete: profiles_fetched=%d accounts_upserted=%d clients_created=%d",
		result.ProfilesFetched, result.AccountsUpserted, result.ClientsCreated,
	)
	for region, r := range result.ByRegion {
		if r.Failed {
			log.Printf("  region %s: FAILED — %s", region, r.Error)
		} else {
			log.Printf("  region %s: %d profiles", region, r.ProfilesFetched)
		}
	}
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
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
