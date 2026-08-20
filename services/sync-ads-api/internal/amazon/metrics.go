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

// AttrWindow is the attribution window suffix used for the campaigns report's
// sales/purchases column names (e.g. "7d" → "sales7d", "purchases7d").
// Change here to switch globally. Search term / targeting reports use both
// 7d and 14d windows — see AttrWindows below — since the brief requires both,
// not just one.
const AttrWindow = "7d"

// AttrWindows is the pair of attribution windows the search term and
// targeting reports both request (7d for recency, 14d for the fuller
// attribution picture) — kept as a slice so both column-builders and any
// future report type share one definition.
var AttrWindows = []string{"7d", "14d"}

// campaignReportColumns builds the spCampaigns column list dynamically from
// AttrWindow so the attribution window is a one-line config change, not
// scattered literals.
func campaignReportColumns() []string {
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

// searchTermReportColumns builds the spSearchTerm column list. Column names
// are Claude's best-effort mapping from Amazon's documented v3 reporting
// schema — NOT yet verified against a real downloaded report. Verify before
// trusting the parser that reads these keys (see sync.processSearchTermReport).
func searchTermReportColumns() []string {
	cols := []string{
		"date",
		"campaignId",
		"adGroupId",
		"keywordId",
		"searchTerm",
		"matchType",
		"impressions",
		"clicks",
		"cost",
	}
	for _, w := range AttrWindows {
		cols = append(cols, "sales"+w, "purchases"+w, "unitsSoldClicks"+w)
	}
	return cols
}

// targetingReportColumns builds the spTargeting column list. Verified against
// a real report's 400 error listing allowed columns: there is no "targetId"
// field — Amazon reuses "keywordId" as the identifier for spTargeting rows
// too (even for product-targeting expressions, not just keyword targets).
func targetingReportColumns() []string {
	cols := []string{
		"date",
		"campaignId",
		"adGroupId",
		"keywordId",
		"targeting",
		"matchType",
		"impressions",
		"clicks",
		"cost",
	}
	for _, w := range AttrWindows {
		cols = append(cols, "sales"+w, "purchases"+w, "unitsSoldClicks"+w)
	}
	return cols
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

// ReportRequestConfig is the Sponsored-Products-only piece of a report type's
// definition — everything RequestReport needs to build the API call. The
// rest of a report type (parsing + storage) lives in the sync package's
// report type registry; this struct is what that registry hands down here.
type ReportRequestConfig struct {
	ReportTypeID string
	GroupBy      []string
	Columns      []string
	NameLabel    string // human label used in the report Name field sent to Amazon
}

// CampaignReportConfig, SearchTermReportConfig, and TargetingReportConfig are
// the three Sponsored Products report types currently supported. Adding a
// fourth (or SB/SD variants later) means adding one more of these plus a
// matching entry in the sync package's report type registry — RequestReport
// itself never changes.
var (
	CampaignReportConfig = ReportRequestConfig{
		ReportTypeID: "spCampaigns",
		GroupBy:      []string{"campaign"},
		Columns:      campaignReportColumns(),
		NameLabel:    "SP Campaigns Daily",
	}
	SearchTermReportConfig = ReportRequestConfig{
		ReportTypeID: "spSearchTerm",
		GroupBy:      []string{"searchTerm"},
		Columns:      searchTermReportColumns(),
		NameLabel:    "SP Search Term Daily",
	}
	TargetingReportConfig = ReportRequestConfig{
		ReportTypeID: "spTargeting",
		GroupBy:      []string{"targeting"},
		Columns:      targetingReportColumns(),
		NameLabel:    "SP Targeting Daily",
	}
)

// RequestReport submits a Sponsored Products report of the given type for one
// profile and returns Amazon's reportId. baseURL is resolved from the
// account's region.
func (c *Client) RequestReport(ctx context.Context, accessToken, baseURL, profileID string, cfg ReportRequestConfig, startDate, endDate string) (string, error) {
	body := reportRequestBody{
		Name:      fmt.Sprintf("%s - %s - %s", cfg.NameLabel, profileID, endDate),
		StartDate: startDate,
		EndDate:   endDate,
		Configuration: reportConfig{
			AdProduct:    "SPONSORED_PRODUCTS",
			GroupBy:      cfg.GroupBy,
			Columns:      cfg.Columns,
			ReportTypeID: cfg.ReportTypeID,
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
			return nil, &StatusError{StatusCode: httpResp.StatusCode, Body: string(b)}
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
			return nil, &StatusError{StatusCode: httpResp.StatusCode, Body: string(b)}
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
