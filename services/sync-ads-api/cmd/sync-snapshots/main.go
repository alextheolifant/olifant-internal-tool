// Command sync-snapshots captures the current state of every SP entity
// (campaigns, ad groups, keywords, targets, negatives, product ads,
// portfolios) for every active account into entity_snapshots_daily — one
// dated row per entity per day. Existing current-state tables are untouched;
// this is additive history alongside them.
//
// Usage:
//
//	sync-snapshots                  # today, UTC
//	sync-snapshots -date 2026-08-11 # backfill/repair a specific day
package main

import (
	"context"
	"encoding/base64"
	"flag"
	"log"
	"os"
	"strings"

	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/sync"
)

func main() {
	ctx := context.Background()

	dateFlag := flag.String("date", sync.TodayUTC(), "snapshot date YYYY-MM-DD")
	profilesFlag := flag.String("profiles", "", "comma-separated profile_ids to scope this run to (default: all active accounts)")
	flag.Parse()

	var profileFilter []string
	if *profilesFlag != "" {
		profileFilter = strings.Split(*profilesFlag, ",")
	}

	clientID := requireEnv("ADS_CLIENT_ID")
	clientSecret := requireEnv("ADS_CLIENT_SECRET")
	encryptionKey := decodeKey(requireEnv("SP_TOKEN_ENCRYPTION_KEY"))

	writer, err := db.NewWriter(ctx, requireEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer writer.Close()

	log.Printf("[snapshot] starting entity snapshot sync for %s", *dateFlag)

	orchestrator := sync.NewSnapshotOrchestrator(clientID, clientSecret, encryptionKey, writer)
	result, err := orchestrator.RunSnapshotSync(ctx, *dateFlag, profileFilter)
	if err != nil {
		log.Fatalf("[snapshot] sync failed: %v", err)
	}

	total := 0
	for entityType, n := range result.RowsByType {
		log.Printf("[snapshot]   %-15s %d rows", entityType, n)
		total += n
	}
	log.Printf("[snapshot] done — accounts: %d processed, %d failed | %d rows total",
		result.AccountsProcessed, result.AccountsFailed, total)
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
