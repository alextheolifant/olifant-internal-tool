package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Writer handles all writes to PostgreSQL from the SP-API sync process.
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

// ── Active accounts ───────────────────────────────────────────────────────────

// SpAccount is a minimal view of amazon_sp_accounts used by sync orchestrators.
// RefreshTokenEncrypted is exactly what's stored — callers decrypt it with
// tokencrypto before use.
type SpAccount struct {
	ID                    string
	ClientID              string
	SellingPartnerID      string
	Marketplace           string
	Region                string
	RefreshTokenEncrypted string
}

// FetchActiveAccounts returns all accounts where is_active = true.
func (w *Writer) FetchActiveAccounts(ctx context.Context) ([]SpAccount, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT id, client_id, selling_partner_id, marketplace, region, refresh_token
		FROM amazon_sp_accounts
		WHERE is_active = true
		ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch active accounts: %w", err)
	}
	defer rows.Close()

	var accounts []SpAccount
	for rows.Next() {
		var a SpAccount
		if err := rows.Scan(&a.ID, &a.ClientID, &a.SellingPartnerID, &a.Marketplace, &a.Region, &a.RefreshTokenEncrypted); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// ── Sync log tracking (sync_logs, scoped to amazon_sp_account_id) ─────────────

// CreateAccountSyncLog creates a sync_log entry scoped to one SP account.
func (w *Writer) CreateAccountSyncLog(ctx context.Context, syncType, accountID string) (string, error) {
	var id string
	err := w.pool.QueryRow(ctx,
		`INSERT INTO sync_logs (sync_type, status, amazon_sp_account_id) VALUES ($1, 'pending', $2) RETURNING id`,
		syncType, accountID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create account sync log: %w", err)
	}
	return id, nil
}

func (w *Writer) MarkSyncRunning(ctx context.Context, logID string) error {
	_, err := w.pool.Exec(ctx, `UPDATE sync_logs SET status = 'running' WHERE id = $1`, logID)
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

// ── Report request tracking (sp_report_requests) ──────────────────────────────

// ReportRequestInsert holds the values for a new sp_report_requests row.
type ReportRequestInsert struct {
	AmazonSPAccountID string
	Region            string
	ReportID          string
	StartDate         string
	EndDate           string
}

// InsertReportRequest persists a new IN_QUEUE report request row and returns its UUID.
func (w *Writer) InsertReportRequest(ctx context.Context, r ReportRequestInsert) (string, error) {
	var id string
	err := w.pool.QueryRow(ctx, `
		INSERT INTO sp_report_requests
			(amazon_sp_account_id, region, report_id, start_date, end_date, status)
		VALUES ($1, $2, $3, $4, $5, 'IN_QUEUE')
		RETURNING id`,
		r.AmazonSPAccountID, r.Region, r.ReportID, r.StartDate, r.EndDate,
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
		SELECT id, report_id FROM sp_report_requests
		WHERE amazon_sp_account_id = $1 AND start_date = $2 AND end_date = $3
		  AND status IN ('IN_QUEUE', 'IN_PROGRESS')
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

// PendingReportRequest is a row returned by GetPendingReportRequests, joined
// with its account so the poller knows which region/marketplace/token to use.
type PendingReportRequest struct {
	ID                string
	AmazonSPAccountID string
	Region            string
	Marketplace       string
	ReportID          string
	StartDate         string
	EndDate           string
}

// GetPendingReportRequests reads all non-terminal rows from sp_report_requests.
func (w *Writer) GetPendingReportRequests(ctx context.Context) ([]PendingReportRequest, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT r.id, r.amazon_sp_account_id, r.region, a.marketplace,
		       r.report_id, r.start_date::text, r.end_date::text
		FROM sp_report_requests r
		JOIN amazon_sp_accounts a ON a.id = r.amazon_sp_account_id
		WHERE r.status IN ('IN_QUEUE', 'IN_PROGRESS')
		ORDER BY r.requested_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("get pending report requests: %w", err)
	}
	defer rows.Close()

	var result []PendingReportRequest
	for rows.Next() {
		var p PendingReportRequest
		if err := rows.Scan(&p.ID, &p.AmazonSPAccountID, &p.Region, &p.Marketplace,
			&p.ReportID, &p.StartDate, &p.EndDate); err != nil {
			return nil, fmt.Errorf("scan pending row: %w", err)
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

// TouchReportRequest records a poll check (updates last_checked_at and status).
func (w *Writer) TouchReportRequest(ctx context.Context, id, status string) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE sp_report_requests SET status = $2, last_checked_at = now() WHERE id = $1`,
		id, status,
	)
	if err != nil {
		return fmt.Errorf("touch report request: %w", err)
	}
	return nil
}

// SetReportDocumentID records the reportDocumentId once a report reaches DONE.
func (w *Writer) SetReportDocumentID(ctx context.Context, id, reportDocumentID string) error {
	_, err := w.pool.Exec(ctx,
		`UPDATE sp_report_requests SET report_document_id = $2 WHERE id = $1`,
		id, reportDocumentID,
	)
	if err != nil {
		return fmt.Errorf("set report document id: %w", err)
	}
	return nil
}

// MarkReportTerminal sets a terminal status + error on a sp_report_requests row.
func (w *Writer) MarkReportTerminal(ctx context.Context, id, status, errMsg string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE sp_report_requests
		SET status = $2, error_message = $3, last_checked_at = now(), completed_at = now()
		WHERE id = $1`,
		id, status, errMsg,
	)
	if err != nil {
		return fmt.Errorf("mark report terminal: %w", err)
	}
	return nil
}

// DeleteReportRequest removes a row after its sales data has been successfully written.
func (w *Writer) DeleteReportRequest(ctx context.Context, id string) error {
	_, err := w.pool.Exec(ctx, `DELETE FROM sp_report_requests WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete report request: %w", err)
	}
	return nil
}

// MarkTimedOutReportRequests sets FATAL on any rows still pending after the deadline.
func (w *Writer) MarkTimedOutReportRequests(ctx context.Context, before time.Time) (int, error) {
	tag, err := w.pool.Exec(ctx, `
		UPDATE sp_report_requests
		SET status = 'FATAL', error_message = 'max wait exceeded', last_checked_at = now()
		WHERE status IN ('IN_QUEUE', 'IN_PROGRESS') AND requested_at < $1`,
		before,
	)
	if err != nil {
		return 0, fmt.Errorf("mark timed out: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// ── Sales upsert (sp_sales_daily) ──────────────────────────────────────────────

// SalesDailyUpsert holds one daily sales row to write to sp_sales_daily.
type SalesDailyUpsert struct {
	AmazonSPAccountID string
	Date              string
	TotalSales        float64
	UnitsOrdered      int64
	Orders            int64
}

// UpsertSalesDaily inserts or updates one row in sp_sales_daily. The unique
// key is (amazon_sp_account_id, date) — re-running for the same range is idempotent.
func (w *Writer) UpsertSalesDaily(ctx context.Context, s SalesDailyUpsert) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO sp_sales_daily (amazon_sp_account_id, date, total_sales, units_ordered, orders)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (amazon_sp_account_id, date) DO UPDATE SET
			total_sales   = EXCLUDED.total_sales,
			units_ordered = EXCLUDED.units_ordered,
			orders        = EXCLUDED.orders,
			updated_at    = now()`,
		s.AmazonSPAccountID, s.Date, s.TotalSales, s.UnitsOrdered, s.Orders,
	)
	if err != nil {
		return fmt.Errorf("upsert sales daily: %w", err)
	}
	return nil
}

// ── Inventory upsert (sp_inventory) ────────────────────────────────────────────

// InventoryUpsert holds one SKU's inventory snapshot to write to sp_inventory.
type InventoryUpsert struct {
	AmazonSPAccountID   string
	ASIN                string
	SellerSKU           string
	FulfillableQuantity int64
	TotalQuantity       int64
}

// UpsertInventory inserts or updates one row in sp_inventory. The unique key
// is (amazon_sp_account_id, asin) — re-running a sync is idempotent.
func (w *Writer) UpsertInventory(ctx context.Context, i InventoryUpsert) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO sp_inventory (amazon_sp_account_id, asin, seller_sku, fulfillable_quantity, total_quantity)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (amazon_sp_account_id, asin) DO UPDATE SET
			seller_sku           = EXCLUDED.seller_sku,
			fulfillable_quantity = EXCLUDED.fulfillable_quantity,
			total_quantity       = EXCLUDED.total_quantity,
			updated_at           = now()`,
		i.AmazonSPAccountID, i.ASIN, i.SellerSKU, i.FulfillableQuantity, i.TotalQuantity,
	)
	if err != nil {
		return fmt.Errorf("upsert inventory: %w", err)
	}
	return nil
}
