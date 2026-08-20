package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
)

// SnapshotResult summarises one entity-snapshot sync run.
type SnapshotResult struct {
	AccountsProcessed int
	AccountsFailed    int
	// RowsByType is the real row volume observed, summed across every
	// account processed — Part 2 of the brief asks this to be reported, not
	// estimated.
	RowsByType map[string]int
}

// SnapshotOrchestrator captures daily SP entity snapshots (Part 1) into
// entity_snapshots_daily (Part 2) for every active account. Extends the
// existing campaign sync's patterns (same region handling, same auth, same
// per-account isolation) rather than building a parallel sync — it reuses
// buildTokenManagers and amazon.RegionBaseURL exactly as campaigns.go does.
type SnapshotOrchestrator struct {
	clientID      string
	clientSecret  string
	encryptionKey []byte
	writer        *db.Writer
	apiClient     *amazon.Client
	tokenManagers map[string]*amazon.TokenManager
}

func NewSnapshotOrchestrator(clientID, clientSecret string, encryptionKey []byte, writer *db.Writer) *SnapshotOrchestrator {
	return &SnapshotOrchestrator{
		clientID:      clientID,
		clientSecret:  clientSecret,
		encryptionKey: encryptionKey,
		writer:        writer,
		apiClient:     amazon.NewClient(clientID, clientSecret, ""),
	}
}

// RunSnapshotSync captures every active account's current SP entity state as
// one dated row per entity. snapshotDate is "YYYY-MM-DD" — callers pass
// today's date for the normal daily run; passing an explicit date is what
// lets this be re-run to backfill/repair a specific day. profileFilter, if
// non-empty, scopes the run to just those Amazon profile ids instead of
// every active account — the normal daily run passes none; it exists for
// backfilling/repairing specific accounts without re-touching the whole book.
func (o *SnapshotOrchestrator) RunSnapshotSync(ctx context.Context, snapshotDate string, profileFilter []string) (SnapshotResult, error) {
	logID, err := o.writer.CreateSyncLog(ctx, "entity_snapshots")
	if err != nil {
		return SnapshotResult{}, fmt.Errorf("create sync log: %w", err)
	}
	if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
		return SnapshotResult{}, fmt.Errorf("mark sync running: %w", err)
	}

	accounts, err := o.writer.FetchActiveAccounts(ctx)
	if err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
		return SnapshotResult{}, fmt.Errorf("fetch active accounts: %w", err)
	}
	if len(profileFilter) > 0 {
		allow := make(map[string]bool, len(profileFilter))
		for _, p := range profileFilter {
			allow[p] = true
		}
		filtered := accounts[:0]
		for _, a := range accounts {
			if allow[a.ProfileID] {
				filtered = append(filtered, a)
			}
		}
		accounts = filtered
	}

	o.tokenManagers = buildTokenManagers(ctx, o.writer, o.clientID, o.clientSecret, o.encryptionKey, "[snapshot]")

	result := SnapshotResult{RowsByType: make(map[string]int)}
	totalRows := 0

	for _, acct := range accounts {
		rows, err := o.syncAccount(ctx, acct, snapshotDate, result.RowsByType)
		if err != nil {
			log.Printf("[snapshot] account %s (profile %s) failed: %v", acct.ID, acct.ProfileID, err)
			result.AccountsFailed++
			continue
		}
		result.AccountsProcessed++
		totalRows += rows
	}

	if err := o.writer.CompleteSyncSuccess(ctx, logID, totalRows); err != nil {
		log.Printf("[snapshot] warn: could not mark sync success: %v", err)
	}

	return result, nil
}

func (o *SnapshotOrchestrator) syncAccount(ctx context.Context, acct db.AdsAccount, snapshotDate string, rowsByType map[string]int) (int, error) {
	tokenManager, ok := o.tokenManagers[acct.AdsManagerAccountID]
	if !ok {
		return 0, fmt.Errorf("no token manager for manager account %q (unset, or its token failed to init)", acct.AdsManagerAccountID)
	}
	token, err := tokenManager.Token(ctx)
	if err != nil {
		return 0, fmt.Errorf("get access token: %w", err)
	}
	baseURL := amazon.RegionBaseURL(acct.Region)

	written := 0

	// ── Campaigns (+ budget usage merged in) ───────────────────────────────
	campaigns, _, err := o.apiClient.ListSPCampaigns(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list campaigns: %w", err)
	}
	usageByCampaign, budgetErrCount, err := o.fetchBudgetUsage(ctx, token, acct, baseURL, campaigns)
	if err != nil {
		// Budget usage is supplementary, not load-bearing for the rest of
		// the snapshot — log and continue with campaign state alone rather
		// than failing the whole account's snapshot over it.
		log.Printf("[snapshot] account %s: budget usage fetch failed, continuing without it: %v", acct.ProfileID, err)
	}
	if budgetErrCount > 0 {
		log.Printf("[snapshot] account %s: budget usage unavailable for %d campaign(s)", acct.ProfileID, budgetErrCount)
	}
	for _, camp := range campaigns {
		state := camp.Raw
		if usage, ok := usageByCampaign[camp.CampaignID]; ok {
			if merged, err := mergeBudgetUsage(camp.Raw, usage); err == nil {
				state = merged
			} else {
				log.Printf("[snapshot] account %s: merge budget usage for campaign %s: %v", acct.ProfileID, camp.CampaignID, err)
			}
		}
		if err := o.upsert(ctx, acct.ID, snapshotDate, "campaign", camp.CampaignID, "", state, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Ad groups ────────────────────────────────────────────────────────
	adGroups, _, err := o.apiClient.ListSPAdGroups(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list ad groups: %w", err)
	}
	for _, ag := range adGroups {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "ad_group", ag.AdGroupID, ag.CampaignID, ag.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Keywords ─────────────────────────────────────────────────────────
	keywords, _, err := o.apiClient.ListSPKeywords(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list keywords: %w", err)
	}
	for _, kw := range keywords {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "keyword", kw.KeywordID, kw.AdGroupID, kw.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Product / category targets ──────────────────────────────────────
	targets, _, err := o.apiClient.ListSPTargets(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list targets: %w", err)
	}
	for _, t := range targets {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "product_target", t.TargetID, t.AdGroupID, t.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Negatives: ad-group keywords, campaign keywords, and targets all
	// share the "negative" entity_type (see schema comment) — their ids are
	// already globally unique within Amazon's own id space, no collision risk.
	negKeywords, _, err := o.apiClient.ListSPNegativeKeywords(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list negative keywords: %w", err)
	}
	for _, nk := range negKeywords {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "negative", nk.KeywordID, nk.AdGroupID, nk.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	campNegKeywords, _, err := o.apiClient.ListSPCampaignNegativeKeywords(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list campaign negative keywords: %w", err)
	}
	for _, nk := range campNegKeywords {
		// Campaign-level negatives have no ad group — parent is the campaign.
		if err := o.upsert(ctx, acct.ID, snapshotDate, "negative", nk.KeywordID, nk.CampaignID, nk.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	negTargets, _, err := o.apiClient.ListSPNegativeTargets(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list negative targets: %w", err)
	}
	for _, nt := range negTargets {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "negative", nt.TargetID, nt.AdGroupID, nt.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Product ads ──────────────────────────────────────────────────────
	productAds, _, err := o.apiClient.ListSPProductAds(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		return written, fmt.Errorf("list product ads: %w", err)
	}
	for _, pa := range productAds {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "product_ad", pa.AdID, pa.AdGroupID, pa.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	// ── Portfolios (account-level, not SP-specific, but captured here for
	// completeness since campaigns reference portfolioId) ──────────────────
	portfolios, err := o.apiClient.ListPortfolios(ctx, token, acct.ProfileID, baseURL)
	if err != nil {
		log.Printf("[snapshot] account %s: list portfolios failed, continuing without them: %v", acct.ProfileID, err)
	}
	for _, p := range portfolios {
		if err := o.upsert(ctx, acct.ID, snapshotDate, "portfolio", p.PortfolioID, "", p.Raw, rowsByType); err != nil {
			return written, err
		}
		written++
	}

	log.Printf("[snapshot] account %s (%s): %d rows captured", acct.ProfileID, acct.Region, written)
	return written, nil
}

// fetchBudgetUsage batches campaign ids into groups (Amazon's endpoint takes
// a list per call — kept modest to avoid one oversized request) and merges
// results into a single campaignId -> usage map. Errors returned per-
// campaign by Amazon's own response are collected separately, not treated
// as a call failure.
func (o *SnapshotOrchestrator) fetchBudgetUsage(
	ctx context.Context,
	token string,
	acct db.AdsAccount,
	baseURL string,
	campaigns []amazon.SPCampaign,
) (map[string]amazon.SPCampaignBudgetUsage, int, error) {
	const batchSize = 100
	usage := make(map[string]amazon.SPCampaignBudgetUsage, len(campaigns))
	errCount := 0

	for i := 0; i < len(campaigns); i += batchSize {
		end := i + batchSize
		if end > len(campaigns) {
			end = len(campaigns)
		}
		ids := make([]string, 0, end-i)
		for _, c := range campaigns[i:end] {
			ids = append(ids, c.CampaignID)
		}
		batchUsage, batchErrs, err := o.apiClient.GetSPBudgetUsage(ctx, token, acct.ProfileID, baseURL, ids)
		if err != nil {
			return usage, errCount, err
		}
		for _, u := range batchUsage {
			usage[u.CampaignID] = u
		}
		errCount += len(batchErrs)
	}
	return usage, errCount, nil
}

// mergeBudgetUsage adds usage fields into a copy of the campaign's raw JSON,
// prefixed to avoid colliding with the campaign's own "budget" object.
func mergeBudgetUsage(campaignRaw json.RawMessage, usage amazon.SPCampaignBudgetUsage) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(campaignRaw, &fields); err != nil {
		return nil, fmt.Errorf("unmarshal campaign for merge: %w", err)
	}
	percentBytes, _ := json.Marshal(usage.BudgetUsagePercent)
	fields["budgetUsagePercent"] = percentBytes
	tsBytes, _ := json.Marshal(usage.UsageUpdatedTimestamp)
	fields["budgetUsageUpdatedTimestamp"] = tsBytes
	return json.Marshal(fields)
}

func (o *SnapshotOrchestrator) upsert(
	ctx context.Context,
	accountID, snapshotDate, entityType, entityID, parentID string,
	state json.RawMessage,
	rowsByType map[string]int,
) error {
	if entityID == "" {
		return nil // defensive — never write a row with no identity
	}
	if err := o.writer.UpsertEntitySnapshot(ctx, db.EntitySnapshotUpsert{
		AmazonAdsAccountID: accountID,
		SnapshotDate:       snapshotDate,
		EntityType:         entityType,
		EntityID:           entityID,
		ParentID:           parentID,
		State:              state,
	}); err != nil {
		return err
	}
	rowsByType[entityType]++
	return nil
}

// TodayUTC returns today's date as "YYYY-MM-DD" in UTC — the default
// snapshotDate for a normal daily run.
func TodayUTC() string {
	return time.Now().UTC().Format("2006-01-02")
}
