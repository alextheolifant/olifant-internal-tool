package sync

import (
	"context"
	"fmt"
	"log"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
)

// CampaignResult summarises a completed campaign sync run.
type CampaignResult struct {
	AccountsProcessed int
	AccountsFailed    int
	CampaignsUpserted int
}

// CampaignOrchestrator pulls SP campaigns for every active account and
// stores them in the campaigns table.
type CampaignOrchestrator struct {
	tokenManager *amazon.TokenManager
	amazonClient *amazon.Client
	writer       *db.Writer
}

func NewCampaignOrchestrator(client *amazon.Client, writer *db.Writer) *CampaignOrchestrator {
	return &CampaignOrchestrator{
		tokenManager: amazon.NewTokenManager(client),
		amazonClient: client,
		writer:       writer,
	}
}

// RunCampaignSync fetches and upserts SP campaigns for all active accounts.
// A failure on one account is logged and skipped; other accounts continue.
func (o *CampaignOrchestrator) RunCampaignSync(ctx context.Context) (CampaignResult, error) {
	logID, err := o.writer.CreateSyncLog(ctx, "ads_campaigns")
	if err != nil {
		return CampaignResult{}, fmt.Errorf("create sync log: %w", err)
	}
	if err := o.writer.MarkSyncRunning(ctx, logID); err != nil {
		return CampaignResult{}, fmt.Errorf("mark sync running: %w", err)
	}

	accounts, err := o.writer.FetchActiveAccounts(ctx)
	if err != nil {
		_ = o.writer.CompleteSyncFailure(ctx, logID, 0, err.Error())
		return CampaignResult{}, fmt.Errorf("fetch active accounts: %w", err)
	}

	if len(accounts) == 0 {
		log.Println("[campaigns] no active accounts found")
		_ = o.writer.CompleteSyncSuccess(ctx, logID, 0)
		return CampaignResult{}, nil
	}

	var result CampaignResult
	result.AccountsProcessed = len(accounts)

	for _, acct := range accounts {
		upserted, err := o.syncAccount(ctx, acct)
		if err != nil {
			log.Printf("[campaigns] account %s (profile %s) failed: %v", acct.ID, acct.ProfileID, err)
			result.AccountsFailed++
			continue
		}
		result.CampaignsUpserted += upserted
	}

	if err := o.writer.CompleteSyncSuccess(ctx, logID, result.CampaignsUpserted); err != nil {
		log.Printf("[campaigns] warn: could not mark sync success: %v", err)
	}

	return result, nil
}

func (o *CampaignOrchestrator) syncAccount(ctx context.Context, acct db.AdsAccount) (int, error) {
	accessToken, err := o.tokenManager.AccessToken(ctx)
	if err != nil {
		return 0, fmt.Errorf("get access token: %w", err)
	}

	campaigns, totalResults, err := o.amazonClient.ListSPCampaigns(ctx, accessToken, acct.ProfileID)
	if err != nil {
		return 0, fmt.Errorf("list SP campaigns: %w", err)
	}

	log.Printf("[campaigns] profile %s: fetched %d campaigns (API reports %d total)",
		acct.ProfileID, len(campaigns), totalResults)

	for _, camp := range campaigns {
		var budget *float64
		if camp.Budget.Budget > 0 {
			b := camp.Budget.Budget
			budget = &b
		}

		if err := o.writer.UpsertCampaign(ctx, db.CampaignUpsert{
			AmazonAdsAccountID: acct.ID,
			CampaignID:         camp.CampaignID,
			Name:               camp.Name,
			State:              camp.State,
			Budget:             budget,
			BudgetType:         camp.Budget.BudgetType,
			TargetingType:      camp.TargetingType,
			StartDate:          camp.StartDate,
			PortfolioID:        camp.PortfolioID,
			BiddingStrategy:    camp.DynamicBidding.Strategy,
			RawData:            []byte(camp.Raw),
		}); err != nil {
			return 0, err
		}
	}

	// Verify stored count matches API's totalResults
	stored, err := o.writer.CountCampaignsForAccount(ctx, acct.ID)
	if err != nil {
		log.Printf("[campaigns] warn: could not verify count for account %s: %v", acct.ID, err)
	} else if stored != totalResults {
		log.Printf("[campaigns] warn: account %s stored %d campaigns but API reported %d total",
			acct.ProfileID, stored, totalResults)
	}

	return len(campaigns), nil
}
