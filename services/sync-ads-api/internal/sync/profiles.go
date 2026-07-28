// Package sync orchestrates the Amazon Advertising profile discovery sync.
// It is the only package that imports both internal/amazon and internal/db,
// translating Amazon API shapes into plain DB write structs.
package sync

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/tokencrypto"
)

const syncTypeAdsProfiles = "ads_profiles"

type Orchestrator struct {
	clientID      string
	clientSecret  string
	encryptionKey []byte
	writer        *db.Writer
}

func NewOrchestrator(clientID, clientSecret string, encryptionKey []byte, writer *db.Writer) *Orchestrator {
	return &Orchestrator{
		clientID:      clientID,
		clientSecret:  clientSecret,
		encryptionKey: encryptionKey,
		writer:        writer,
	}
}

// RegionResult holds the per-region outcome of a profile fetch, merged
// across every manager account that was queried for that region.
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

// taggedProfile pairs a profile with the region and manager account it came
// from, plus that manager account's connected_at — needed to break ties if
// the same profileId is returned by more than one manager account.
type taggedProfile struct {
	profile            amazon.Profile
	region             string
	managerAccountID   string
	managerConnectedAt time.Time
}

// RunProfilesSync fetches every Amazon Advertising profile across all three
// Amazon regions (NA, EU, FE) for every active manager account, and upserts
// each into clients/amazon_ads_accounts. A manager account whose token can't
// be decrypted or exchanged is logged and skipped — it must not block the
// others. If one region's call fails for one manager account, the others
// still proceed — partial success is recorded. Profiles are processed
// sequentially (not concurrently) so that two profiles for the same brand
// reliably resolve to the same client_id within a single run.
func (o *Orchestrator) RunProfilesSync(ctx context.Context) (Result, error) {
	result := Result{ByRegion: make(map[string]RegionResult, len(amazon.Regions))}

	logID, err := o.writer.CreateSyncLog(ctx, syncTypeAdsProfiles)
	if err != nil {
		return result, fmt.Errorf("create sync log: %w", err)
	}
	if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
		return result, fmt.Errorf("mark sync running: %w", err)
	}

	managerAccounts, err := o.writer.FetchActiveManagerAccounts(ctx)
	if err != nil {
		o.fail(ctx, logID, result.AccountsUpserted, err)
		return result, fmt.Errorf("fetch active manager accounts: %w", err)
	}
	if len(managerAccounts) == 0 {
		log.Println("no active manager accounts found")
		if err := o.writer.CompleteSyncSuccess(ctx, logID, 0); err != nil {
			return result, fmt.Errorf("complete sync success: %w", err)
		}
		return result, nil
	}

	// Fetch profiles from every region, for every manager account whose
	// token exchange succeeds; continue on per-manager-account or per-region
	// failure — one bad token must not block the rest.
	var tagged []taggedProfile
	for _, ma := range managerAccounts {
		refreshToken, err := tokencrypto.Decrypt(o.encryptionKey, ma.EncryptedRefreshToken)
		if err != nil {
			log.Printf("manager account %s: decrypt failed, skipping: %v", ma.ID, err)
			continue
		}
		client := amazon.NewClient(o.clientID, o.clientSecret, refreshToken)
		token, err := client.ExchangeRefreshToken(ctx)
		if err != nil {
			log.Printf("manager account %s: token exchange failed, skipping: %v", ma.ID, err)
			continue
		}

		for _, r := range amazon.Regions {
			profiles, fetchErr := client.ListProfiles(ctx, token.AccessToken, r.BaseURL)
			existing := result.ByRegion[r.Name]
			if fetchErr != nil {
				log.Printf("manager account %s region %s: fetch failed: %v", ma.ID, r.Name, fetchErr)
				existing.Failed = true
				existing.Error = fetchErr.Error()
				result.ByRegion[r.Name] = existing
				continue
			}
			log.Printf("manager account %s region %s: fetched %d profiles", ma.ID, r.Name, len(profiles))
			existing.ProfilesFetched += len(profiles)
			result.ByRegion[r.Name] = existing
			for _, p := range profiles {
				tagged = append(tagged, taggedProfile{
					profile:            p,
					region:             r.Name,
					managerAccountID:   ma.ID,
					managerConnectedAt: ma.ConnectedAt,
				})
			}
		}
	}

	deduped := dedupeByProfileID(tagged)
	result.ProfilesFetched = len(deduped)

	// Upsert all collected profiles sequentially.
	for _, tp := range deduped {
		created, err := o.upsertProfile(ctx, tp.profile, tp.region, tp.managerAccountID)
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

// dedupeByProfileID collapses tagged profiles down to one per Amazon
// profileId, in case the same profile is returned by more than one manager
// account (shouldn't normally happen). The most-recently-connected manager
// account wins; the loser is logged as a warning rather than silently
// dropped. Preserves original encounter order (not map iteration order) so
// upsertProfile's same-brand-across-regions sequential-resolution guarantee
// still holds.
func dedupeByProfileID(tagged []taggedProfile) []taggedProfile {
	winners := make(map[int64]taggedProfile, len(tagged))
	var order []int64

	for _, tp := range tagged {
		existing, seen := winners[tp.profile.ProfileID]
		if !seen {
			winners[tp.profile.ProfileID] = tp
			order = append(order, tp.profile.ProfileID)
			continue
		}

		winner, loser := existing, tp
		if tp.managerConnectedAt.After(existing.managerConnectedAt) {
			winner, loser = tp, existing
			winners[tp.profile.ProfileID] = tp
		}
		log.Printf(
			"WARN: profile %d returned by multiple manager accounts (%s connected %s, %s connected %s) — using %s (most recently connected)",
			tp.profile.ProfileID,
			loser.managerAccountID, loser.managerConnectedAt,
			winner.managerAccountID, winner.managerConnectedAt,
			winner.managerAccountID,
		)
	}

	deduped := make([]taggedProfile, 0, len(order))
	for _, id := range order {
		deduped = append(deduped, winners[id])
	}
	return deduped
}

// upsertProfile resolves the profile's client and writes its ads account
// row inside one transaction. Returns whether a new client was created.
func (o *Orchestrator) upsertProfile(ctx context.Context, p amazon.Profile, region, managerAccountID string) (bool, error) {
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
		AdsManagerAccountID: managerAccountID,
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
