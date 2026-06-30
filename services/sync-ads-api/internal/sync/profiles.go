// Package sync orchestrates the Amazon Advertising profile discovery sync.
// It is the only package that imports both internal/amazon and internal/db,
// translating Amazon API shapes into plain DB write structs.
package sync

import (
	"context"
	"fmt"
	"strconv"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
)

const syncTypeAdsProfiles = "ads_profiles"

type Orchestrator struct {
	amazonClient *amazon.Client
	writer       *db.Writer
}

func NewOrchestrator(amazonClient *amazon.Client, writer *db.Writer) *Orchestrator {
	return &Orchestrator{amazonClient: amazonClient, writer: writer}
}

// Result summarizes what a sync run did.
type Result struct {
	ProfilesFetched  int
	AccountsUpserted int
	ClientsCreated   int
}

// RunProfilesSync fetches every Amazon Advertising profile accessible to the
// developer account and upserts it into clients/amazon_ads_accounts.
// Profiles are processed sequentially (not concurrently) so that two
// profiles for the same brand reliably resolve to the same client_id within
// a single run.
func (o *Orchestrator) RunProfilesSync(ctx context.Context) (Result, error) {
	var result Result

	logID, err := o.writer.CreateSyncLog(ctx, syncTypeAdsProfiles)
	if err != nil {
		return result, fmt.Errorf("create sync log: %w", err)
	}
	if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
		return result, fmt.Errorf("mark sync running: %w", err)
	}

	token, err := o.amazonClient.ExchangeRefreshToken(ctx)
	if err != nil {
		o.fail(ctx, logID, result.AccountsUpserted, err)
		return result, fmt.Errorf("exchange refresh token: %w", err)
	}

	profiles, err := o.amazonClient.ListProfiles(ctx, token.AccessToken)
	if err != nil {
		o.fail(ctx, logID, result.AccountsUpserted, err)
		return result, fmt.Errorf("list profiles: %w", err)
	}
	result.ProfilesFetched = len(profiles)

	for _, p := range profiles {
		created, err := o.upsertProfile(ctx, p)
		if err != nil {
			o.fail(ctx, logID, result.AccountsUpserted, err)
			return result, fmt.Errorf("upsert profile %d: %w", p.ProfileID, err)
		}
		result.AccountsUpserted++
		if created {
			result.ClientsCreated++
		}
	}

	if err := o.writer.CompleteSyncSuccess(ctx, logID, result.AccountsUpserted); err != nil {
		return result, fmt.Errorf("complete sync success: %w", err)
	}
	return result, nil
}

// upsertProfile resolves the profile's client and writes its ads account
// row inside one transaction. Returns whether a new client was created.
func (o *Orchestrator) upsertProfile(ctx context.Context, p amazon.Profile) (bool, error) {
	tx, err := o.writer.BeginTx(ctx)
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	brandName := p.AccountInfo.Name
	clientID, created, err := o.writer.FindOrCreateClient(ctx, tx, brandName)
	if err != nil {
		return false, fmt.Errorf("find or create client: %w", err)
	}

	err = o.writer.UpsertAdsAccount(ctx, tx, db.AdsAccountUpsert{
		ClientID:            clientID,
		ProfileID:           strconv.FormatInt(p.ProfileID, 10),
		AccountName:         brandName,
		Marketplace:         p.CountryCode,
		CountryCode:         p.CountryCode,
		CurrencyCode:        p.CurrencyCode,
		Timezone:            p.Timezone,
		AccountType:         p.AccountInfo.Type,
		MarketplaceStringID: p.AccountInfo.MarketplaceStringID,
	})
	if err != nil {
		return false, fmt.Errorf("upsert ads account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return created, nil
}

func (o *Orchestrator) fail(ctx context.Context, logID string, recordsSynced int, cause error) {
	_ = o.writer.CompleteSyncFailure(ctx, logID, recordsSynced, cause.Error())
}
