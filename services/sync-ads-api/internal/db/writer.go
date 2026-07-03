package db

import (
	"context"
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
}

// UpsertAdsAccount inserts or updates an amazon_ads_accounts row keyed on
// profile_id. is_active is intentionally absent from the UPDATE SET clause:
// it is only ever set by the column's DEFAULT true on INSERT, so a manually
// deactivated account is never silently reactivated by a re-sync.
func (w *Writer) UpsertAdsAccount(ctx context.Context, tx pgx.Tx, row AdsAccountUpsert) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO amazon_ads_accounts (
			client_id, profile_id, account_name, marketplace, country_code,
			currency_code, timezone, account_type, marketplace_string_id, region
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
			updated_at = now()
	`,
		row.ClientID, row.ProfileID, row.AccountName, row.Marketplace, row.CountryCode,
		row.CurrencyCode, row.Timezone, row.AccountType, row.MarketplaceStringID, row.Region,
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
	ID        string // PostgreSQL UUID (for FK joins to campaigns table)
	ProfileID string // Amazon profile_id (for API scope header + ClickHouse writes)
	Region    string // 'na' | 'eu' | 'fe'
}

// FetchActiveAccounts returns all accounts where is_active = true.
func (w *Writer) FetchActiveAccounts(ctx context.Context) ([]AdsAccount, error) {
	rows, err := w.pool.Query(ctx,
		`SELECT id, profile_id, region FROM amazon_ads_accounts WHERE is_active = true ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch active accounts: %w", err)
	}
	defer rows.Close()

	var accounts []AdsAccount
	for rows.Next() {
		var a AdsAccount
		if err := rows.Scan(&a.ID, &a.ProfileID, &a.Region); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// ── Report request tracking ───────────────────────────────────────────────────

// ReportRequestInsert holds the values for a new ads_report_requests row.
type ReportRequestInsert struct {
	AmazonAdsAccountID string
	SyncLogID          string
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
			(amazon_ads_account_id, sync_log_id, region, report_id, start_date, end_date, status, retry_count)
		VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
		RETURNING id`,
		r.AmazonAdsAccountID, r.SyncLogID, r.Region, r.ReportID, r.StartDate, r.EndDate, r.RetryCount,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert report request: %w", err)
	}
	return id, nil
}

// FindActiveReportRequest checks whether a non-terminal row already exists for
// this account + date range (from a previous run). Returns (rowID, reportID, found).
func (w *Writer) FindActiveReportRequest(ctx context.Context, accountID, startDate, endDate string) (string, string, bool, error) {
	var rowID, reportID string
	err := w.pool.QueryRow(ctx, `
		SELECT id, report_id FROM ads_report_requests
		WHERE amazon_ads_account_id = $1 AND start_date = $2 AND end_date = $3
		  AND status IN ('PENDING', 'PROCESSING')
		LIMIT 1`,
		accountID, startDate, endDate,
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
	ID                 string
	AmazonAdsAccountID string
	ProfileID          string
	Region             string
	ReportID           string
	SyncLogID          string
	StartDate          string
	EndDate            string
}

// GetPendingReportRequests reads all non-terminal rows from ads_report_requests.
// Joining amazon_ads_accounts avoids needing to store profile_id in the request table.
func (w *Writer) GetPendingReportRequests(ctx context.Context) ([]PendingReportRequest, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT r.id, r.amazon_ads_account_id, a.profile_id, r.region,
		       r.report_id, COALESCE(r.sync_log_id::text, ''), r.start_date::text, r.end_date::text
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
		if err := rows.Scan(&p.ID, &p.AmazonAdsAccountID, &p.ProfileID, &p.Region,
			&p.ReportID, &p.SyncLogID, &p.StartDate, &p.EndDate); err != nil {
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
	ID                 string
	AmazonAdsAccountID string
	ProfileID          string
	Region             string
	StartDate          string
	EndDate            string
	RetryCount         int
}

// FetchRetryableReportRequests returns all rows with a terminal-failure status
// (TIMED_OUT, FAILED, CANCELLED) that have not yet been escalated to FAILED_PERMANENT.
func (w *Writer) FetchRetryableReportRequests(ctx context.Context) ([]RetryableReportRequest, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT r.id, r.amazon_ads_account_id, a.profile_id, r.region,
		       r.start_date::text, r.end_date::text, r.retry_count
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
		if err := rows.Scan(&r.ID, &r.AmazonAdsAccountID, &r.ProfileID, &r.Region,
			&r.StartDate, &r.EndDate, &r.RetryCount); err != nil {
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
			(amazon_ads_account_id, sync_log_id, region, report_id, start_date, end_date, status, retry_count)
		VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
		RETURNING id`,
		r.AmazonAdsAccountID, r.SyncLogID, r.Region, r.ReportID, r.StartDate, r.EndDate, r.RetryCount,
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
	ACoS         float64
	ROAS         float64
	CPC          float64
	CTR          float64
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
