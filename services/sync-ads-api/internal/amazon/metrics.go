package amazon

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AttrWindow is the attribution window suffix used for sales/purchases column
// names (e.g. "7d" → "sales7d", "purchases7d"). Change here to switch globally.
const AttrWindow = "7d"

// reportColumns builds the column list dynamically from AttrWindow so the
// attribution window is a one-line config change, not scattered literals.
func reportColumns() []string {
	return []string{
		"campaignId",
		"date",
		"impressions",
		"clicks",
		"cost",
		"sales" + AttrWindow,
		"purchases" + AttrWindow,
		"costPerClick",
		"clickThroughRate",
	}
}

// reportRequestBody is the JSON body for POST /reporting/reports.
type reportRequestBody struct {
	Name          string       `json:"name"`
	StartDate     string       `json:"startDate"`
	EndDate       string       `json:"endDate"`
	Configuration reportConfig `json:"configuration"`
}

type reportConfig struct {
	AdProduct    string   `json:"adProduct"`
	GroupBy      []string `json:"groupBy"`
	Columns      []string `json:"columns"`
	ReportTypeID string   `json:"reportTypeId"`
	TimeUnit     string   `json:"timeUnit"`
	Format       string   `json:"format"`
}

// ReportResponse is the response from POST /reporting/reports and GET /reporting/reports/{id}.
type ReportResponse struct {
	ReportID      string `json:"reportId"`
	Status        string `json:"status"`
	URL           string `json:"url"`
	URLExpiresAt  string `json:"urlExpiresAt"`
	FileSize      int64  `json:"fileSize"`
	FailureReason string `json:"failureReason"`
}

// RequestReport submits an SP campaigns daily report for one profile and
// returns Amazon's reportId. baseURL is resolved from the account's region.
func (c *Client) RequestReport(ctx context.Context, accessToken, baseURL, profileID, startDate, endDate string) (string, error) {
	body := reportRequestBody{
		Name:      fmt.Sprintf("SP Campaigns Daily - %s - %s", profileID, endDate),
		StartDate: startDate,
		EndDate:   endDate,
		Configuration: reportConfig{
			AdProduct:    "SPONSORED_PRODUCTS",
			GroupBy:      []string{"campaign"},
			Columns:      reportColumns(),
			ReportTypeID: "spCampaigns",
			TimeUnit:     "DAILY",
			Format:       "GZIP_JSON",
		},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal report request: %w", err)
	}

	resp, err := withRetry(ctx, func() (*ReportResponse, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			baseURL+"/reporting/reports", strings.NewReader(string(payload)))
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
		req.Header.Set("Amazon-Advertising-API-Scope", profileID)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/vnd.createasyncreportrequest.v3+json")

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK && httpResp.StatusCode != 202 {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}
		var r ReportResponse
		if err := json.Unmarshal(b, &r); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		return &r, nil
	})
	if err != nil {
		return "", err
	}
	return resp.ReportID, nil
}

// GetReportStatus polls one report and returns its current status/URL.
func (c *Client) GetReportStatus(ctx context.Context, accessToken, baseURL, profileID, reportID string) (*ReportResponse, error) {
	return withRetry(ctx, func() (*ReportResponse, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			baseURL+"/reporting/reports/"+reportID, nil)
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
		req.Header.Set("Amazon-Advertising-API-Scope", profileID)
		req.Header.Set("Authorization", "Bearer "+accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}
		var r ReportResponse
		if err := json.Unmarshal(b, &r); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		return &r, nil
	})
}

// DownloadReport fetches and decompresses the GZIP_JSON report file from the
// signed S3 URL. The URL must be used exactly as received — do not re-encode.
// Returns one map per daily campaign row with raw JSON values.
func (c *Client) DownloadReport(ctx context.Context, downloadURL string) ([]map[string]json.RawMessage, error) {
	return withRetry(ctx, func() ([]map[string]json.RawMessage, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			return nil, fmt.Errorf("build download request: %w", err)
		}

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("download http: %w", err)}
		}
		defer httpResp.Body.Close()

		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("download status %d", httpResp.StatusCode)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("download status %d", httpResp.StatusCode)
		}

		gz, err := gzip.NewReader(httpResp.Body)
		if err != nil {
			return nil, fmt.Errorf("gzip open: %w", err)
		}
		defer gz.Close()

		raw, err := io.ReadAll(gz)
		if err != nil {
			return nil, fmt.Errorf("gzip read: %w", err)
		}

		var records []map[string]json.RawMessage
		if err := json.Unmarshal(raw, &records); err != nil {
			return nil, fmt.Errorf("json parse: %w", err)
		}
		return records, nil
	})
}
