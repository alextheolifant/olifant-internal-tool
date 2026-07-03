package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// CHWriter writes campaign metrics to ClickHouse via the HTTP interface.
// Idempotency: DELETE existing rows for the account+date range, then INSERT fresh.
type CHWriter struct {
	baseURL string // e.g. "http://olifant:pass@localhost:8123/"
	db      string // e.g. "olifant"
	client  *http.Client
}

// NewCHWriter parses the ClickHouse URL (http://user:pass@host:port/dbname)
// and returns a ready-to-use writer.
func NewCHWriter(rawURL string) (*CHWriter, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse clickhouse url: %w", err)
	}
	db := strings.TrimPrefix(u.Path, "/")
	if db == "" {
		db = "default"
	}
	u.Path = "/"
	return &CHWriter{
		baseURL: u.String(),
		db:      db,
		client:  &http.Client{Timeout: 60 * time.Second},
	}, nil
}

// exec runs a DDL/DML statement (DELETE, etc.) against the HTTP interface.
func (ch *CHWriter) exec(ctx context.Context, query string) error {
	endpoint := ch.baseURL + "?database=" + url.QueryEscape(ch.db) +
		"&allow_experimental_lightweight_delete=1"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(query))
	if err != nil {
		return fmt.Errorf("build exec request: %w", err)
	}
	req.Header.Set("Content-Type", "text/plain")

	resp, err := ch.client.Do(req)
	if err != nil {
		return fmt.Errorf("clickhouse exec: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("clickhouse exec status %d: %s", resp.StatusCode, body)
	}
	return nil
}

// CHRow is one row to write to the campaign_metrics ClickHouse table.
type CHRow struct {
	AccountID   string  `json:"account_id"`
	CampaignID  string  `json:"campaign_id"`
	Date        string  `json:"date"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	Spend       float64 `json:"spend"`
	Sales       float64 `json:"sales"`
	Orders      int64   `json:"orders"`
	ACoS        float64 `json:"acos"`
	ROAS        float64 `json:"roas"`
	CTR         float64 `json:"ctr"`
	CPC         float64 `json:"cpc"`
}

// DeleteMetrics removes existing rows for this account and date range so a
// re-sync doesn't double-count. MergeTree's lightweight DELETE is immediately
// visible to subsequent SELECTs even before background merges complete.
func (ch *CHWriter) DeleteMetrics(ctx context.Context, accountID, startDate, endDate string) error {
	q := fmt.Sprintf(
		"DELETE FROM %s.campaign_metrics WHERE account_id = '%s' AND date >= '%s' AND date <= '%s'",
		ch.db, accountID, startDate, endDate,
	)
	return ch.exec(ctx, q)
}

// InsertMetrics bulk-inserts rows using JSONEachRow format.
func (ch *CHWriter) InsertMetrics(ctx context.Context, rows []CHRow) error {
	if len(rows) == 0 {
		return nil
	}

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, r := range rows {
		if err := enc.Encode(r); err != nil {
			return fmt.Errorf("encode row: %w", err)
		}
	}

	endpoint := ch.baseURL + "?database=" + url.QueryEscape(ch.db) +
		"&query=" + url.QueryEscape("INSERT INTO campaign_metrics FORMAT JSONEachRow")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return fmt.Errorf("build insert request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	resp, err := ch.client.Do(req)
	if err != nil {
		return fmt.Errorf("clickhouse insert: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("clickhouse insert status %d: %s", resp.StatusCode, body)
	}
	return nil
}
