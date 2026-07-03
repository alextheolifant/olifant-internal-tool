// Package sync orchestrates the Amazon Advertising profile discovery sync.
// It is the only package that imports both internal/amazon and internal/db,
// translating Amazon API shapes into plain DB write structs.
package sync

import (
	"context"
	"fmt"
	"log"
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

// RegionResult holds the per-region outcome of a profile fetch.
type RegionResult struct {
	ProfilesFetched int
	Failed          bool
	Error           string
}

// Result summarizes what a sync run did.
type Result struct {
	ProfilesFetched  int
	AccountsUpserted int
	ClientsCreated   int
	ByRegion         map[string]RegionResult
}

// taggedProfile pairs a profile with the region it came from.
type taggedProfile struct {
	profile amazon.Profile
	region  string
}

// RunProfilesSync fetches every Amazon Advertising profile across all three
// Amazon regions (NA, EU, FE) and upserts it into clients/amazon_ads_accounts.
// If one region's call fails the others still proceed — partial success is
// recorded. Profiles are processed sequentially (not concurrently) so that
// two profiles for the same brand reliably resolve to the same client_id
// within a single run.
func (o *Orchestrator) RunProfilesSync(ctx context.Context) (Result, error) {
	result := Result{ByRegion: make(map[string]RegionResult, len(amazon.Regions))}

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

	// Fetch profiles from all three regions; continue on per-region failure.
	var tagged []taggedProfile
	for _, r := range amazon.Regions {
		profiles, fetchErr := o.amazonClient.ListProfiles(ctx, token.AccessToken, r.BaseURL)
		if fetchErr != nil {
			log.Printf("region %s: fetch failed: %v", r.Name, fetchErr)
			result.ByRegion[r.Name] = RegionResult{Failed: true, Error: fetchErr.Error()}
			continue
		}
		log.Printf("region %s: fetched %d profiles", r.Name, len(profiles))
		result.ByRegion[r.Name] = RegionResult{ProfilesFetched: len(profiles)}
		for _, p := range profiles {
			tagged = append(tagged, taggedProfile{profile: p, region: r.Name})
		}
	}

	result.ProfilesFetched = len(tagged)

	// Upsert all collected profiles sequentially.
	for _, tp := range tagged {
		created, err := o.upsertProfile(ctx, tp.profile, tp.region)
		if err != nil {
			o.fail(ctx, logID, result.AccountsUpserted, err)
			return result, fmt.Errorf("upsert profile %d: %w", tp.profile.ProfileID, err)
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
func (o *Orchestrator) upsertProfile(ctx context.Context, p amazon.Profile, region string) (bool, error) {
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
		Region:              region,
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
