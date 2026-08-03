package sync

import (
	"context"
	"fmt"
	"log"

	"olifant/sync-sp-api/internal/amazon"
	"olifant/sync-sp-api/internal/db"
	"olifant/sync-sp-api/internal/tokencrypto"
)

const syncTypeCatalogItems = "catalog_items"

// CatalogResult summarises one SyncCatalog run.
type CatalogResult struct {
	AccountsOK      int
	AccountsSkipped int // no product_economics ASINs to look up yet
	AccountsFailed  int
	RecordsWritten  int
}

// CatalogOrchestrator looks up product name/status via SP-API Catalog Items
// for every ASIN already entered in product_economics, and enriches those
// rows' product_name. It never creates product_economics rows itself — ASIN
// entry stays a manual, team-driven action (see FetchClientAsins).
type CatalogOrchestrator struct {
	writer          *db.Writer
	lwaClientID     string
	lwaClientSecret string
	encryptionKey   []byte
}

func NewCatalogOrchestrator(w *db.Writer, lwaClientID, lwaClientSecret string, encryptionKey []byte) *CatalogOrchestrator {
	return &CatalogOrchestrator{
		writer:          w,
		lwaClientID:     lwaClientID,
		lwaClientSecret: lwaClientSecret,
		encryptionKey:   encryptionKey,
	}
}

// SyncCatalog processes accounts sequentially — one account's failure never
// blocks the rest.
func (o *CatalogOrchestrator) SyncCatalog(ctx context.Context, accounts []db.SpAccount) *CatalogResult {
	result := &CatalogResult{}

	for _, a := range accounts {
		asins, err := o.writer.FetchClientAsins(ctx, a.ClientID)
		if err != nil {
			log.Printf("WARN: account %s: fetch client asins failed: %v — skipping", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}
		if len(asins) == 0 {
			log.Printf("account %s: no product_economics ASINs entered yet — nothing to look up", a.SellingPartnerID)
			result.AccountsSkipped++
			continue
		}

		refreshToken, err := tokencrypto.Decrypt(o.encryptionKey, a.RefreshTokenEncrypted)
		if err != nil {
			log.Printf("WARN: account %s: decrypt refresh token failed: %v — skipping", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		client := amazon.NewClient(o.lwaClientID, o.lwaClientSecret, refreshToken)
		tokens := amazon.NewTokenManager(client)
		region := amazon.RegionByName(a.Region)

		logID, err := o.writer.CreateAccountSyncLog(ctx, syncTypeCatalogItems, a.ID)
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

		written, err := o.syncAccountCatalog(ctx, client, tokens, region, a, asins)
		if err != nil {
			_ = o.writer.CompleteSyncFailure(ctx, logID, written, err.Error())
			log.Printf("account %s: catalog sync failed: %v", a.SellingPartnerID, err)
			result.AccountsFailed++
			continue
		}

		_ = o.writer.CompleteSyncSuccess(ctx, logID, written)
		result.AccountsOK++
		result.RecordsWritten += written
		log.Printf("account %s: wrote %d catalog item rows", a.SellingPartnerID, written)
	}

	return result
}

func (o *CatalogOrchestrator) syncAccountCatalog(ctx context.Context, client *amazon.Client, tokens *amazon.TokenManager, region amazon.Region, a db.SpAccount, asins []string) (int, error) {
	written := 0

	for _, batch := range amazon.ChunkASINs(asins) {
		nextToken := ""
		for {
			token, err := tokens.Token(ctx)
			if err != nil {
				return written, fmt.Errorf("get token: %w", err)
			}

			items, next, err := client.GetCatalogItems(ctx, token, region, a.Marketplace, batch, nextToken)
			if err != nil {
				return written, fmt.Errorf("get catalog items: %w", err)
			}

			for _, item := range items {
				name, status := amazon.ExtractNameAndStatus(item)

				if err := o.writer.UpsertCatalogItem(ctx, db.CatalogItemUpsert{
					AmazonSPAccountID: a.ID,
					ASIN:              item.ASIN,
					ProductName:       name,
					Status:            status,
				}); err != nil {
					return written, fmt.Errorf("upsert catalog item: %w", err)
				}
				written++

				if err := o.writer.PropagateProductName(ctx, a.ClientID, item.ASIN, name); err != nil {
					return written, fmt.Errorf("propagate product name: %w", err)
				}
			}

			if next == "" {
				break
			}
			nextToken = next
		}
	}

	return written, nil
}
