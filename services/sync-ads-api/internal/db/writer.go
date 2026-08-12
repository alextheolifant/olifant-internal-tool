package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

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
	Region              string
	AdsManagerAccountID string
}

// UpsertAdsAccount inserts or updates an amazon_ads_accounts row keyed on
// profile_id. is_active is intentionally absent from the UPDATE SET clause:
// it is only ever set by the column's DEFAULT true on INSERT, so a manually
// deactivated account is never silently reactivated by a re-sync.
// ads_manager_account_id, unlike is_active, IS updated on re-sync — which
// manager account currently owns a profile can legitimately change.
func (w *Writer) UpsertAdsAccount(ctx context.Context, tx pgx.Tx, row AdsAccountUpsert) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO amazon_ads_accounts (
			client_id, profile_id, account_name, marketplace, country_code,
			currency_code, timezone, account_type, marketplace_string_id, region,
			ads_manager_account_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (profile_id) DO UPDATE SET
			client_id = EXCLUDED.client_id,
			account_name = EXCLUDED.account_name,
			marketplace = EXCLUDED.marketplace,
			country_code = EXCLUDED.country_code,
			currency_code = EXCLUDED.currency_code,
			timezone = EXCLUDED.timezone,
			account_type = EXCLUDED.account_type,
			marketplace_string_id = EXCLUDED.marketplace_string_id,
			region = EXCLUDED.region,
			ads_manager_account_id = EXCLUDED.ads_manager_account_id,
			updated_at = now()
	`,
		row.ClientID, row.ProfileID, row.AccountName, row.Marketplace, row.CountryCode,
		row.CurrencyCode, row.Timezone, row.AccountType, row.MarketplaceStringID, row.Region,
		row.AdsManagerAccountID,
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

// CreateAccountSyncLog creates a sync_log entry scoped to one ads account.
func (w *Writer) CreateAccountSyncLog(ctx context.Context, syncType, accountID string) (string, error) {
	var id string
	err := w.pool.QueryRow(ctx,
		`INSERT INTO sync_logs (sync_type, status, amazon_ads_account_id) VALUES ($1, 'pending', $2) RETURNING id`,
		syncType, accountID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create account sync log: %w", err)
	}
	return id, nil
}

// ── Active accounts ───────────────────────────────────────────────────────────

// AdsAccount is a minimal view of amazon_ads_accounts used by sync orchestrators.
type AdsAccount struct {
	ID                  string // PostgreSQL UUID (for FK joins to campaigns table)
	ProfileID           string // Amazon profile_id (for API scope header + ClickHouse writes)
	Region              string // 'na' | 'eu' | 'fe'
	AdsManagerAccountID string // '' if unset (e.g. never touched by profile sync post-migration)
}

// FetchActiveAccounts returns all accounts where is_active = true.
func (w *Writer) FetchActiveAccounts(ctx context.Context) ([]AdsAccount, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT id, profile_id, region, COALESCE(ads_manager_account_id::text, '')
		 FROM amazon_ads_accounts WHERE is_active = true ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch active accounts: %w", err)
	}
	defer rows.Close()

	var accounts []AdsAccount
	for rows.Next() {
		var a AdsAccount
		if err := rows.Scan(&a.ID, &a.ProfileID, &a.Region, &a.AdsManagerAccountID); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// ── Manager accounts ──────────────────────────────────────────────────────────

// ManagerAccount is a minimal view of ads_manager_accounts used to build one
// amazon.Client/TokenManager per connected manager account.
type ManagerAccount struct {
	ID                    string
	EncryptedRefreshToken string
	ConnectedAt           time.Time
}

// FetchActiveManagerAccounts returns all manager accounts where is_active =
// true, ordered by connected_at. Unscoped by organization — there is only
// one organization row today and this sync layer has no other org-awareness
// to plug an organization_id filter into; revisit if a second org appears.
func (w *Writer) FetchActiveManagerAccounts(ctx context.Context) ([]ManagerAccount, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT id, refresh_token, connected_at FROM ads_manager_accounts
		 WHERE is_active = true ORDER BY connected_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch active manager accounts: %w", err)
	}
	defer rows.Close()

	var accounts []ManagerAccount
	for rows.Next() {
		var a ManagerAccount
		if err := rows.Scan(&a.ID, &a.EncryptedRefreshToken, &a.ConnectedAt); err != nil {
			return nil, fmt.Errorf("scan manager account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// ── Campaign upsert ───────────────────────────────────────────────────────────

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

// UpsertCampaign inserts or updates a campaign row keyed on (amazon_ads_account_id, campaign_id).
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

// CountCampaignsForAccount returns the number of campaigns stored for the given
// amazon_ads_account_id. Used to verify against totalResults from the API.
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

// ── Report request tracking ───────────────────────────────────────────────────

// ReportRequestInsert holds the values for a new ads_report_requests row.
type ReportRequestInsert struct {
	AmazonAdsAccountID string
	SyncLogID          string
	ReportType         string // registry key, e.g. "campaigns" | "searchTerm" | "targeting"
	Region             string
	ReportID           string
	StartDate          string
	EndDate            string
	RetryCount         int // 0 for fresh requests; >0 for retries
}

// InsertReportRequest persists a new PENDING report request row and returns its UUID.
func (w *Writer) InsertReportRequest(ctx context.Context, r ReportRequestInsert) (string, error) {
	var id string
	err := w.pool.QueryRow(ctx, `
		INSERT INTO ads_report_requests
			(amazon_ads_account_id, sync_log_id, report_type, region, report_id, start_date, end_date, status, retry_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
		RETURNING id`,
		r.AmazonAdsAccountID, r.SyncLogID, r.ReportType, r.Region, r.ReportID, r.StartDate, r.EndDate, r.RetryCount,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert report request: %w", err)
	}
	return id, nil
}

// FindActiveReportRequest checks whether a non-terminal row already exists for
// this account + report type + date range (from a previous run). Scoping by
// reportType matters: otherwise an in-flight campaigns report would make this
// look "found" and silently skip submitting a search-term report for the same
// account/date range. Returns (rowID, reportID, found).
func (w *Writer) FindActiveReportRequest(ctx context.Context, accountID, reportType, startDate, endDate string) (string, string, bool, error) {
	var rowID, reportID string
	err := w.pool.QueryRow(ctx, `
		SELECT id, report_id FROM ads_report_requests
		WHERE amazon_ads_account_id = $1 AND report_type = $2 AND start_date = $3 AND end_date = $4
		  AND status IN ('PENDING', 'PROCESSING')
		LIMIT 1`,
		accountID, reportType, startDate, endDate,
	).Scan(&rowID, &reportID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return "", "", false, nil
		}
		return "", "", false, fmt.Errorf("find active report request: %w", err)
	}
	return rowID, reportID, true, nil
}

// PendingReportRequest is a row returned by GetPendingReportRequests.
type PendingReportRequest struct {
	ID                  string
	AmazonAdsAccountID  string
	ProfileID           string
	ReportType          string
	Region              string
	ReportID            string
	SyncLogID           string
	StartDate           string
	EndDate             string
	AdsManagerAccountID string
}

// GetPendingReportRequests reads all non-terminal rows from ads_report_requests.
// Joining amazon_ads_accounts avoids needing to store profile_id (and now
// ads_manager_account_id, for Phase 2's per-account token resolution) in the
// request table itself. report_type tells the poller which report-type
// config (and therefore which parser/table) to dispatch each row to.
func (w *Writer) GetPendingReportRequests(ctx context.Context) ([]PendingReportRequest, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT r.id, r.amazon_ads_account_id, a.profile_id, r.report_type, r.region,
		       r.report_id, COALESCE(r.sync_log_id::text, ''), r.start_date::text, r.end_date::text,
		       COALESCE(a.ads_manager_account_id::text, '')
		FROM ads_report_requests r
		JOIN amazon_ads_accounts a ON a.id = r.amazon_ads_account_id
		WHERE r.status IN ('PENDING', 'PROCESSING')
		ORDER BY r.requested_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("get pending report requests: %w", err)
	}
	defer rows.Close()

	var result []PendingReportRequest
	for rows.Next() {
		var p PendingReportRequest
		if err := rows.Scan(&p.ID, &p.AmazonAdsAccountID, &p.ProfileID, &p.ReportType, &p.Region,
			&p.ReportID, &p.SyncLogID, &p.StartDate, &p.EndDate, &p.AdsManagerAccountID); err != nil {
			return nil, fmt.Errorf("scan pending row: %w", err)
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

// TouchReportRequest records a poll check (updates last_checked_at and optionally status).
func (w *Writer) TouchReportRequest(ctx context.Context, id, status string) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE ads_report_requests SET status = $2, last_checked_at = now() WHERE id = $1`,
		id, status,
	)
	if err != nil {
		return fmt.Errorf("touch report request: %w", err)
	}
	return nil
}

// MarkReportTerminal sets a terminal status + error on an ads_report_requests row.
func (w *Writer) MarkReportTerminal(ctx context.Context, id, status, errMsg string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE ads_report_requests
		SET status = $2, error_message = $3, last_checked_at = now(), completed_at = now()
		WHERE id = $1`,
		id, status, errMsg,
	)
	if err != nil {
		return fmt.Errorf("mark report terminal: %w", err)
	}
	return nil
}

// DeleteReportRequest removes a row after its metrics have been successfully written.
func (w *Writer) DeleteReportRequest(ctx context.Context, id string) error {
	_, err := w.pool.Exec(ctx, `DELETE FROM ads_report_requests WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete report request: %w", err)
	}
	return nil
}

// MarkTimedOutReportRequests sets TIMED_OUT on any rows still pending after the deadline.
func (w *Writer) MarkTimedOutReportRequests(ctx context.Context, before time.Time) (int, error) {
	tag, err := w.pool.Exec(ctx, `
		UPDATE ads_report_requests
		SET status = 'TIMED_OUT', error_message = 'max wait exceeded', last_checked_at = now()
		WHERE status IN ('PENDING', 'PROCESSING') AND requested_at < $1`,
		before,
	)
	if err != nil {
		return 0, fmt.Errorf("mark timed out: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// ── Retry helpers ─────────────────────────────────────────────────────────────

// RetryableReportRequest is a terminal ads_report_requests row eligible for retry.
type RetryableReportRequest struct {
	ID                  string
	AmazonAdsAccountID  string
	ProfileID           string
	ReportType          string
	Region              string
	StartDate           string
	EndDate             string
	RetryCount          int
	AdsManagerAccountID string
}

// FetchRetryableReportRequests returns all rows with a terminal-failure status
// (TIMED_OUT, FAILED, CANCELLED) that have not yet been escalated to FAILED_PERMANENT.
func (w *Writer) FetchRetryableReportRequests(ctx context.Context) ([]RetryableReportRequest, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT r.id, r.amazon_ads_account_id, a.profile_id, r.report_type, r.region,
		       r.start_date::text, r.end_date::text, r.retry_count,
		       COALESCE(a.ads_manager_account_id::text, '')
		FROM ads_report_requests r
		JOIN amazon_ads_accounts a ON a.id = r.amazon_ads_account_id
		WHERE r.status IN ('TIMED_OUT', 'FAILED', 'CANCELLED')
		ORDER BY r.requested_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch retryable report requests: %w", err)
	}
	defer rows.Close()

	var result []RetryableReportRequest
	for rows.Next() {
		var r RetryableReportRequest
		if err := rows.Scan(&r.ID, &r.AmazonAdsAccountID, &r.ProfileID, &r.ReportType, &r.Region,
			&r.StartDate, &r.EndDate, &r.RetryCount, &r.AdsManagerAccountID); err != nil {
			return nil, fmt.Errorf("scan retryable row: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// MarkReportPermanentFailure escalates a terminal row to FAILED_PERMANENT when
// the retry cap has been reached. No new request will be submitted for this row.
func (w *Writer) MarkReportPermanentFailure(ctx context.Context, id, reason string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE ads_report_requests
		SET status = 'FAILED_PERMANENT', error_message = $2, last_checked_at = now()
		WHERE id = $1`,
		id, reason,
	)
	if err != nil {
		return fmt.Errorf("mark report permanent failure: %w", err)
	}
	return nil
}

// ReplaceWithRetry atomically inserts a new PENDING row (with incremented retry_count)
// and deletes the old terminal row, returning the new row's UUID.
// Uses a transaction so there is no window where neither row exists.
func (w *Writer) ReplaceWithRetry(ctx context.Context, oldID string, r ReportRequestInsert) (string, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var newID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO ads_report_requests
			(amazon_ads_account_id, sync_log_id, report_type, region, report_id, start_date, end_date, status, retry_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
		RETURNING id`,
		r.AmazonAdsAccountID, r.SyncLogID, r.ReportType, r.Region, r.ReportID, r.StartDate, r.EndDate, r.RetryCount,
	).Scan(&newID); err != nil {
		return "", fmt.Errorf("insert retry row: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM ads_report_requests WHERE id = $1`, oldID); err != nil {
		return "", fmt.Errorf("delete old row: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit retry tx: %w", err)
	}
	return newID, nil
}

// ── Campaign lookup ───────────────────────────────────────────────────────────

// FetchCampaignUUIDs returns a map of amazon campaign_id → PostgreSQL UUID
// for one ads account. Used to join report rows to campaigns.id before upsert.
func (w *Writer) FetchCampaignUUIDs(ctx context.Context, accountID string) (map[string]string, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT campaign_id, id FROM campaigns WHERE amazon_ads_account_id = $1`,
		accountID,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch campaign uuids: %w", err)
	}
	defer rows.Close()

	m := make(map[string]string)
	for rows.Next() {
		var amazonID, pgID string
		if err := rows.Scan(&amazonID, &pgID); err != nil {
			return nil, fmt.Errorf("scan campaign: %w", err)
		}
		m[amazonID] = pgID
	}
	return m, rows.Err()
}

// ── Metrics upsert ────────────────────────────────────────────────────────────

// MetricUpsert holds one daily campaign metric row to write to campaign_metrics_daily.
type MetricUpsert struct {
	CampaignUUID string
	Date         string
	Impressions  int64
	Clicks       int64
	Spend        float64
	Sales        float64
	Orders       int64
	// ACoS/ROAS are pointers, not plain float64: campaign_metrics_daily
	// stores them as numeric(8,4) (max magnitude ~9999.9999), but they're
	// computed locally as unbounded ratios (cost/sales, sales/cost) — a
	// campaign with near-zero sales relative to spend (or vice versa) can
	// easily exceed that. nil means "not a meaningful/storable ratio for
	// this row", not zero.
	ACoS *float64
	ROAS *float64
	CPC  float64
	CTR  float64
}

// UpsertMetric inserts or updates one row in campaign_metrics_daily.
// The unique key is (campaign_id, date) — re-running for the same range is idempotent.
func (w *Writer) UpsertMetric(ctx context.Context, m MetricUpsert) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO campaign_metrics_daily
			(campaign_id, date, impressions, clicks, spend, sales, orders, acos, roas, cpc, ctr)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (campaign_id, date) DO UPDATE SET
			impressions = EXCLUDED.impressions,
			clicks      = EXCLUDED.clicks,
			spend       = EXCLUDED.spend,
			sales       = EXCLUDED.sales,
			orders      = EXCLUDED.orders,
			acos        = EXCLUDED.acos,
			roas        = EXCLUDED.roas,
			cpc         = EXCLUDED.cpc,
			ctr         = EXCLUDED.ctr`,
		m.CampaignUUID, m.Date, m.Impressions, m.Clicks,
		m.Spend, m.Sales, m.Orders, m.ACoS, m.ROAS, m.CPC, m.CTR,
	)
	if err != nil {
		return fmt.Errorf("upsert metric: %w", err)
	}
	return nil
}

// ── Search term metrics upsert ────────────────────────────────────────────────

// SearchTermMetricUpsert holds one daily search-term row to write to
// search_term_metrics_daily. KeywordID/MatchType are "" for auto/product-
// targeting search terms that have no keyword.
type SearchTermMetricUpsert struct {
	AmazonAdsAccountID string
	Date               string
	SearchTerm         string
	KeywordID          string
	CampaignID         string
	AdGroupID          string
	MatchType          string
	Impressions        int64
	Clicks             int64
	Cost               float64
	Sales7d            float64
	Sales14d           float64
	Orders7d           int64
	Orders14d          int64
	Units7d            int64
	Units14d           int64
}

// UpsertSearchTermMetric inserts or updates one row in search_term_metrics_daily.
// The ON CONFLICT target expression must match uq_search_term_metrics exactly
// (including the COALESCE) for Postgres to use it as the arbiter index.
func (w *Writer) UpsertSearchTermMetric(ctx context.Context, m SearchTermMetricUpsert) error {
	keywordID := nullableString(m.KeywordID)
	matchType := nullableString(m.MatchType)

	_, err := w.pool.Exec(ctx, `
		INSERT INTO search_term_metrics_daily
			(amazon_ads_account_id, date, search_term, keyword_id, campaign_id, ad_group_id, match_type,
			 impressions, clicks, cost, sales_7d, sales_14d, orders_7d, orders_14d, units_7d, units_14d)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (amazon_ads_account_id, date, search_term, COALESCE(keyword_id, ''), campaign_id, ad_group_id)
		DO UPDATE SET
			match_type  = EXCLUDED.match_type,
			impressions = EXCLUDED.impressions,
			clicks      = EXCLUDED.clicks,
			cost        = EXCLUDED.cost,
			sales_7d    = EXCLUDED.sales_7d,
			sales_14d   = EXCLUDED.sales_14d,
			orders_7d   = EXCLUDED.orders_7d,
			orders_14d  = EXCLUDED.orders_14d,
			units_7d    = EXCLUDED.units_7d,
			units_14d   = EXCLUDED.units_14d,
			updated_at  = now()`,
		m.AmazonAdsAccountID, m.Date, m.SearchTerm, keywordID, m.CampaignID, m.AdGroupID, matchType,
		m.Impressions, m.Clicks, m.Cost, m.Sales7d, m.Sales14d, m.Orders7d, m.Orders14d, m.Units7d, m.Units14d,
	)
	if err != nil {
		return fmt.Errorf("upsert search term metric: %w", err)
	}
	return nil
}

// ── Target metrics upsert ─────────────────────────────────────────────────────

// TargetMetricUpsert holds one daily targeting row to write to target_metrics_daily.
// MatchType is "" for product targets (only keyword targets have a match type).
type TargetMetricUpsert struct {
	AmazonAdsAccountID string
	Date               string
	TargetID           string
	Expression         string
	MatchType          string
	CampaignID         string
	AdGroupID          string
	Impressions        int64
	Clicks             int64
	Cost               float64
	Sales7d            float64
	Sales14d           float64
	Orders7d           int64
	Orders14d          int64
	Units7d            int64
	Units14d           int64
}

// UpsertTargetMetric inserts or updates one row in target_metrics_daily.
// The unique key is (amazon_ads_account_id, date, target_id).
func (w *Writer) UpsertTargetMetric(ctx context.Context, m TargetMetricUpsert) error {
	matchType := nullableString(m.MatchType)

	_, err := w.pool.Exec(ctx, `
		INSERT INTO target_metrics_daily
			(amazon_ads_account_id, date, target_id, expression, match_type, campaign_id, ad_group_id,
			 impressions, clicks, cost, sales_7d, sales_14d, orders_7d, orders_14d, units_7d, units_14d)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (amazon_ads_account_id, date, target_id)
		DO UPDATE SET
			expression  = EXCLUDED.expression,
			match_type  = EXCLUDED.match_type,
			campaign_id = EXCLUDED.campaign_id,
			ad_group_id = EXCLUDED.ad_group_id,
			impressions = EXCLUDED.impressions,
			clicks      = EXCLUDED.clicks,
			cost        = EXCLUDED.cost,
			sales_7d    = EXCLUDED.sales_7d,
			sales_14d   = EXCLUDED.sales_14d,
			orders_7d   = EXCLUDED.orders_7d,
			orders_14d  = EXCLUDED.orders_14d,
			units_7d    = EXCLUDED.units_7d,
			units_14d   = EXCLUDED.units_14d,
			updated_at  = now()`,
		m.AmazonAdsAccountID, m.Date, m.TargetID, m.Expression, matchType, m.CampaignID, m.AdGroupID,
		m.Impressions, m.Clicks, m.Cost, m.Sales7d, m.Sales14d, m.Orders7d, m.Orders14d, m.Units7d, m.Units14d,
	)
	if err != nil {
		return fmt.Errorf("upsert target metric: %w", err)
	}
	return nil
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ── Entity snapshots (versioned daily history) ────────────────────────────────

// EntitySnapshotUpsert holds one entity's captured state for one day.
// SnapshotDate is "YYYY-MM-DD". ParentID is "" for entities with no parent
// (campaigns, portfolios). State is the raw JSON exactly as Amazon returned
// it for that entity — see diffEntityState (diff.go) for how it's read back.
type EntitySnapshotUpsert struct {
	AmazonAdsAccountID string
	SnapshotDate        string
	EntityType          string
	EntityID            string
	ParentID            string
	State               json.RawMessage
}

// UpsertEntitySnapshot inserts or updates one row in entity_snapshots_daily.
// Re-running the same day's snapshot (e.g. after a crash) overwrites that
// day's row rather than duplicating it — the unique key is
// (account, date, entity_type, entity_id), matching the append-ONE-row-per-
// day-not-per-run design (Part 2 of the brief).
func (w *Writer) UpsertEntitySnapshot(ctx context.Context, s EntitySnapshotUpsert) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO entity_snapshots_daily
			(amazon_ads_account_id, snapshot_date, entity_type, entity_id, parent_id, state)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (amazon_ads_account_id, snapshot_date, entity_type, entity_id)
		DO UPDATE SET
			parent_id = EXCLUDED.parent_id,
			state     = EXCLUDED.state`,
		s.AmazonAdsAccountID, s.SnapshotDate, s.EntityType, s.EntityID, nullableString(s.ParentID), s.State,
	)
	if err != nil {
		return fmt.Errorf("upsert entity snapshot (%s %s): %w", s.EntityType, s.EntityID, err)
	}
	return nil
}

// CountSnapshotsForAccountDate returns how many entity_snapshots_daily rows
// exist for one account on one date, broken down by entity_type — used to
// report real row volume per account per day (Part 2's retention question).
func (w *Writer) CountSnapshotsForAccountDate(ctx context.Context, accountID, snapshotDate string) (map[string]int, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT entity_type, COUNT(*) FROM entity_snapshots_daily
		 WHERE amazon_ads_account_id = $1 AND snapshot_date = $2
		 GROUP BY entity_type`,
		accountID, snapshotDate,
	)
	if err != nil {
		return nil, fmt.Errorf("count snapshots: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var entityType string
		var n int
		if err := rows.Scan(&entityType, &n); err != nil {
			return nil, fmt.Errorf("scan snapshot count: %w", err)
		}
		counts[entityType] = n
	}
	return counts, rows.Err()
}

// EntitySnapshotRow is one dated snapshot as read back for diffing.
type EntitySnapshotRow struct {
	SnapshotDate string
	EntityID     string
	ParentID     string // "" if none
	State        json.RawMessage
}

// GetEntitySnapshot returns one entity's captured state on one exact date,
// or (EntitySnapshotRow{}, false, nil) if no snapshot exists for that date.
func (w *Writer) GetEntitySnapshot(ctx context.Context, accountID, entityType, entityID, snapshotDate string) (EntitySnapshotRow, bool, error) {
	var row EntitySnapshotRow
	var parentID *string
	row.EntityID = entityID
	err := w.pool.QueryRow(ctx,
		`SELECT snapshot_date::text, parent_id, state FROM entity_snapshots_daily
		 WHERE amazon_ads_account_id = $1 AND entity_type = $2 AND entity_id = $3 AND snapshot_date = $4`,
		accountID, entityType, entityID, snapshotDate,
	).Scan(&row.SnapshotDate, &parentID, &row.State)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return EntitySnapshotRow{}, false, nil
		}
		return EntitySnapshotRow{}, false, fmt.Errorf("get entity snapshot: %w", err)
	}
	if parentID != nil {
		row.ParentID = *parentID
	}
	return row, true, nil
}

// ListEntitySnapshotsForDate returns every snapshot of one entity_type for
// one account on one date — the bulk diff variant's per-side data source
// (diffAccountState in diff.go calls this once for "yesterday" and once for
// "today" per entity type, rather than one query per entity).
func (w *Writer) ListEntitySnapshotsForDate(ctx context.Context, accountID, entityType, snapshotDate string) ([]EntitySnapshotRow, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT entity_id, parent_id, state FROM entity_snapshots_daily
		 WHERE amazon_ads_account_id = $1 AND entity_type = $2 AND snapshot_date = $3`,
		accountID, entityType, snapshotDate,
	)
	if err != nil {
		return nil, fmt.Errorf("list entity snapshots: %w", err)
	}
	defer rows.Close()

	var out []EntitySnapshotRow
	for rows.Next() {
		var r EntitySnapshotRow
		var parentID *string
		r.SnapshotDate = snapshotDate
		if err := rows.Scan(&r.EntityID, &parentID, &r.State); err != nil {
			return nil, fmt.Errorf("scan entity snapshot: %w", err)
		}
		if parentID != nil {
			r.ParentID = *parentID
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
