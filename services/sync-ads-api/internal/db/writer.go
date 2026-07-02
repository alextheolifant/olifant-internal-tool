package db

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Writer handles all writes to PostgreSQL from the Advertising API sync process.
type Writer struct {
	pool *pgxpool.Pool
}

func NewWriter(ctx context.Context, dsn string) (*Writer, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Writer{pool: pool}, nil
}

func (w *Writer) Close() {
	w.pool.Close()
}

// FindOrCreateClient resolves a brand name to a clients.id, normalizing on
// trim + case-insensitive comparison so multi-country Amazon profiles for
// the same brand map to a single client row. clients.name has no unique
// constraint, so this is a select-then-insert rather than a true upsert;
// callers must process profiles sequentially within a run to avoid races.
// Returns the client id and whether a new client row was created.
func (w *Writer) FindOrCreateClient(ctx context.Context, tx pgx.Tx, brandName string) (string, bool, error) {
	normalized := strings.TrimSpace(brandName)

	var id string
	err := tx.QueryRow(ctx,
		`SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
		normalized,
	).Scan(&id)
	if err == nil {
		return id, false, nil
	}
	if err != pgx.ErrNoRows {
		return "", false, fmt.Errorf("find client: %w", err)
	}

	err = tx.QueryRow(ctx,
		`INSERT INTO clients (name, status) VALUES ($1, 'onboarding') RETURNING id`,
		normalized,
	).Scan(&id)
	if err != nil {
		return "", false, fmt.Errorf("create client: %w", err)
	}
	return id, true, nil
}

// AdsAccountUpsert holds the fields written to amazon_ads_accounts for a
// single Amazon Advertising profile.
type AdsAccountUpsert struct {
	ClientID            string
	ProfileID           string
	AccountName         string
	Marketplace         string
	CountryCode         string
	CurrencyCode        string
	Timezone            string
	AccountType         string
	MarketplaceStringID string
}

// UpsertAdsAccount inserts or updates an amazon_ads_accounts row keyed on
// profile_id. is_active is intentionally absent from the UPDATE SET clause:
// it is only ever set by the column's DEFAULT true on INSERT, so a manually
// deactivated account is never silently reactivated by a re-sync.
func (w *Writer) UpsertAdsAccount(ctx context.Context, tx pgx.Tx, row AdsAccountUpsert) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO amazon_ads_accounts (
			client_id, profile_id, account_name, marketplace, country_code,
			currency_code, timezone, account_type, marketplace_string_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (profile_id) DO UPDATE SET
			client_id = EXCLUDED.client_id,
			account_name = EXCLUDED.account_name,
			marketplace = EXCLUDED.marketplace,
			country_code = EXCLUDED.country_code,
			currency_code = EXCLUDED.currency_code,
			timezone = EXCLUDED.timezone,
			account_type = EXCLUDED.account_type,
			marketplace_string_id = EXCLUDED.marketplace_string_id,
			updated_at = now()
	`,
		row.ClientID, row.ProfileID, row.AccountName, row.Marketplace, row.CountryCode,
		row.CurrencyCode, row.Timezone, row.AccountType, row.MarketplaceStringID,
	)
	if err != nil {
		return fmt.Errorf("upsert ads account: %w", err)
	}
	return nil
}

// BeginTx starts a transaction for a caller to wrap one profile's writes in.
func (w *Writer) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return w.pool.Begin(ctx)
}

func (w *Writer) CreateSyncLog(ctx context.Context, syncType string) (string, error) {
	var id string
	err := w.pool.QueryRow(ctx,
		`INSERT INTO sync_logs (sync_type, status) VALUES ($1, 'pending') RETURNING id`,
		syncType,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create sync log: %w", err)
	}
	return id, nil
}

func (w *Writer) MarkSyncRunning(ctx context.Context, logID string) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE sync_logs SET status = 'running' WHERE id = $1`,
		logID,
	)
	if err != nil {
		return fmt.Errorf("mark sync running: %w", err)
	}
	return nil
}

func (w *Writer) CompleteSyncSuccess(ctx context.Context, logID string, recordsSynced int) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE sync_logs SET status = 'success', completed_at = now(), records_synced = $2 WHERE id = $1`,
		logID, recordsSynced,
	)
	if err != nil {
		return fmt.Errorf("complete sync success: %w", err)
	}
	return nil
}

func (w *Writer) CompleteSyncFailure(ctx context.Context, logID string, recordsSynced int, errMsg string) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE sync_logs SET status = 'failed', completed_at = now(), records_synced = $2, error_message = $3 WHERE id = $1`,
		logID, recordsSynced, errMsg,
	)
	if err != nil {
		return fmt.Errorf("complete sync failure: %w", err)
	}
	return nil
}

// AdsAccount is a minimal view of amazon_ads_accounts used by sync jobs.
type AdsAccount struct {
	ID        string // uuid
	ProfileID string
	ClientID  string
}

// FetchActiveAccounts returns all amazon_ads_accounts rows where is_active = true.
func (w *Writer) FetchActiveAccounts(ctx context.Context) ([]AdsAccount, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT id, profile_id, client_id FROM amazon_ads_accounts WHERE is_active = true ORDER BY profile_id`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch active accounts: %w", err)
	}
	defer rows.Close()

	var accounts []AdsAccount
	for rows.Next() {
		var a AdsAccount
		if err := rows.Scan(&a.ID, &a.ProfileID, &a.ClientID); err != nil {
			return nil, fmt.Errorf("scan account row: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// CampaignUpsert holds the fields written to the campaigns table.
type CampaignUpsert struct {
	AmazonAdsAccountID string
	CampaignID         string
	Name               string
	State              string
	Budget             *float64
	BudgetType         string
	TargetingType      string
	StartDate          string // "YYYY-MM-DD" or ""
	PortfolioID        string
	BiddingStrategy    string
	RawData            []byte // JSON
}

// UpsertCampaign inserts or updates a campaign row keyed on
// (amazon_ads_account_id, campaign_id).
func (w *Writer) UpsertCampaign(ctx context.Context, row CampaignUpsert) error {
	var startDate *string
	if row.StartDate != "" {
		startDate = &row.StartDate
	}
	var portfolioID *string
	if row.PortfolioID != "" {
		portfolioID = &row.PortfolioID
	}
	var biddingStrategy *string
	if row.BiddingStrategy != "" {
		biddingStrategy = &row.BiddingStrategy
	}
	var name *string
	if row.Name != "" {
		name = &row.Name
	}
	var budgetType *string
	if row.BudgetType != "" {
		budgetType = &row.BudgetType
	}
	var targetingType *string
	if row.TargetingType != "" {
		targetingType = &row.TargetingType
	}

	_, err := w.pool.Exec(ctx, `
		INSERT INTO campaigns (
			amazon_ads_account_id, campaign_id, name, state,
			budget, budget_type, targeting_type,
			start_date, portfolio_id, bidding_strategy, raw_data
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (amazon_ads_account_id, campaign_id) DO UPDATE SET
			name             = EXCLUDED.name,
			state            = EXCLUDED.state,
			budget           = EXCLUDED.budget,
			budget_type      = EXCLUDED.budget_type,
			targeting_type   = EXCLUDED.targeting_type,
			start_date       = EXCLUDED.start_date,
			portfolio_id     = EXCLUDED.portfolio_id,
			bidding_strategy = EXCLUDED.bidding_strategy,
			raw_data         = EXCLUDED.raw_data,
			updated_at       = now()
	`,
		row.AmazonAdsAccountID, row.CampaignID, name, row.State,
		row.Budget, budgetType, targetingType,
		startDate, portfolioID, biddingStrategy, row.RawData,
	)
	if err != nil {
		return fmt.Errorf("upsert campaign %s: %w", row.CampaignID, err)
	}
	return nil
}

// CountCampaignsForAccount returns the number of campaigns stored for the
// given amazon_ads_account_id. Used to verify against totalResults from API.
func (w *Writer) CountCampaignsForAccount(ctx context.Context, accountID string) (int, error) {
	var count int
	err := w.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM campaigns WHERE amazon_ads_account_id = $1`,
		accountID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count campaigns: %w", err)
	}
	return count, nil
}
