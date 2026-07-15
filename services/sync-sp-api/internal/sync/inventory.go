package sync

import (
	"context"
	"fmt"
	"log"

	"olifant/sync-sp-api/internal/amazon"
	"olifant/sync-sp-api/internal/db"
	"olifant/sync-sp-api/internal/tokencrypto"
)

const syncTypeSpInventory = "sp_inventory"

// InventoryResult summarises one SyncInventory run.
type InventoryResult struct {
	AccountsOK     int
	AccountsFailed int
	RecordsWritten int
}

// InventoryOrchestrator drives the (simpler, non-report-based) FBA inventory
// sync: one direct paginated call per account, no submit/poll cycle.
type InventoryOrchestrator struct {
	signer          *amazon.RequestSigner
	writer          *db.Writer
	lwaClientID     string
	lwaClientSecret string
	encryptionKey   []byte
}

func NewInventoryOrchestrator(signer *amazon.RequestSigner, w *db.Writer, lwaClientID, lwaClientSecret string, encryptionKey []byte) *InventoryOrchestrator {
	return &InventoryOrchestrator{
		signer:          signer,
		writer:          w,
		lwaClientID:     lwaClientID,
		lwaClientSecret: lwaClientSecret,
		encryptionKey:   encryptionKey,
	}
}

// SyncInventory processes accounts sequentially — one account's failure
// (decrypt error, API error) never blocks the rest.
func (o *InventoryOrchestrator) SyncInventory(ctx context.Context, accounts []db.SpAccount) *InventoryResult {
	result := &InventoryResult{}

	for _, a := range accounts {
		refreshToken, err := tokencrypto.Decrypt(o.encryptionKey, a.RefreshTokenEncrypted)
		if err != nil {
			log.Printf("WARN: account %s: decrypt refresh token failed: %v — skipping", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		client := amazon.NewClient(o.lwaClientID, o.lwaClientSecret, refreshToken)
		tokens := amazon.NewTokenManager(client)
		region := amazon.RegionByName(a.Region)

		logID, err := o.writer.CreateAccountSyncLog(ctx, syncTypeSpInventory, a.ID)
		if err != nil {
			log.Printf("account %s: create sync log failed: %v", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}
		if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
			log.Printf("account %s: mark running failed: %v", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		written, err := o.syncAccountInventory(ctx, client, tokens, region, a)
		if err != nil {
			_ = o.writer.CompleteSyncFailure(ctx, logID, written, err.Error())
			log.Printf("account %s: inventory sync failed: %v", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		_ = o.writer.CompleteSyncSuccess(ctx, logID, written)
		result.AccountsOK++
		result.RecordsWritten += written
		log.Printf("account %s: wrote %d inventory rows", a.SellingPartnerID, written)
	}

	return result
}

func (o *InventoryOrchestrator) syncAccountInventory(ctx context.Context, client *amazon.Client, tokens *amazon.TokenManager, region amazon.Region, a db.SpAccount) (int, error) {
	written := 0
	nextToken := ""

	for {
		token, err := tokens.Token(ctx)
		if err != nil {
			return written, fmt.Errorf("get token: %w", err)
		}

		summaries, next, err := client.GetInventorySummaries(ctx, o.signer, token, region, a.Marketplace, nextToken)
		if err != nil {
			return written, fmt.Errorf("get inventory summaries: %w", err)
		}

		for _, s := range summaries {
			if err := o.writer.UpsertInventory(ctx, db.InventoryUpsert{
				AmazonSPAccountID:   a.ID,
				ASIN:                s.ASIN,
				SellerSKU:           s.SellerSKU,
				FulfillableQuantity: int64(s.InventoryDetails.FulfillableQuantity),
				TotalQuantity:       int64(s.TotalQuantity),
			}); err != nil {
				return written, fmt.Errorf("upsert inventory: %w", err)
			}
			written++
		}

		if next == "" {
			break
		}
		nextToken = next
	}

	return written, nil
}
