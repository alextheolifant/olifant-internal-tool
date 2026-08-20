package amazon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ─── SP entity list endpoints ───────────────────────────────────────────────
// Same request/pagination/retry shape as ListSPCampaigns (campaigns.go) for
// every entity type — one small per-type wrapper around a shared pager.

type spListRequest struct {
	StateFilter struct {
		Include []string `json:"include"`
	} `json:"stateFilter"`
	MaxResults int    `json:"maxResults"`
	NextToken  string `json:"nextToken,omitempty"`
}

func defaultSPListRequest() spListRequest {
	var r spListRequest
	r.StateFilter.Include = []string{"ENABLED", "PAUSED", "ARCHIVED"}
	r.MaxResults = 100
	return r
}

// listSPPage POSTs one page of any /sp/*/list endpoint and returns the raw
// item array plus the response envelope's nextToken/totalResults. itemsKey
// is the response JSON's array field name (e.g. "adGroups", "keywords") —
// each entity type's response envelope uses a different key for the same
// {items, nextToken, totalResults} shape.
func listSPPage(
	ctx context.Context,
	c *Client,
	accessToken, profileID, baseURL, path, contentType, itemsKey string,
	reqBody spListRequest,
) ([]json.RawMessage, string, int, error) {
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, "", 0, fmt.Errorf("marshal request: %w", err)
	}

	type envelope struct {
		NextToken    string                     `json:"nextToken"`
		TotalResults int                        `json:"totalResults"`
		Items        map[string]json.RawMessage `json:"-"`
	}

	page, err := withRetry(ctx, func() (*envelope, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
		req.Header.Set("Amazon-Advertising-API-Scope", profileID)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Accept", contentType)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, err := io.ReadAll(httpResp.Body)
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(b, &raw); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		var e envelope
		if nt, ok := raw["nextToken"]; ok {
			_ = json.Unmarshal(nt, &e.NextToken)
		}
		if tr, ok := raw["totalResults"]; ok {
			_ = json.Unmarshal(tr, &e.TotalResults)
		}
		e.Items = raw
		return &e, nil
	})
	if err != nil {
		return nil, "", 0, err
	}

	itemsRaw, ok := page.Items[itemsKey]
	if !ok {
		return nil, page.NextToken, page.TotalResults, fmt.Errorf("response missing %q array", itemsKey)
	}
	var items []json.RawMessage
	if err := json.Unmarshal(itemsRaw, &items); err != nil {
		return nil, "", 0, fmt.Errorf("decode %q array: %w", itemsKey, err)
	}
	return items, page.NextToken, page.TotalResults, nil
}

// listSPAll drives listSPPage across every page for one entity type.
func listSPAll(
	ctx context.Context,
	c *Client,
	accessToken, profileID, baseURL, path, contentType, itemsKey string,
) ([]json.RawMessage, int, error) {
	var all []json.RawMessage
	var totalResults int
	nextToken := ""
	firstPage := true

	for firstPage || nextToken != "" {
		firstPage = false
		reqBody := defaultSPListRequest()
		if nextToken != "" {
			reqBody.NextToken = nextToken
		}
		items, nt, total, err := listSPPage(ctx, c, accessToken, profileID, baseURL, path, contentType, itemsKey, reqBody)
		if err != nil {
			return nil, 0, err
		}
		all = append(all, items...)
		nextToken = nt
		totalResults = total
	}
	return all, totalResults, nil
}

// ── Ad groups ──────────────────────────────────────────────────────────────

type SPAdGroup struct {
	AdGroupID  string          `json:"adGroupId"`
	CampaignID string          `json:"campaignId"`
	Name       string          `json:"name"`
	State      string          `json:"state"`
	DefaultBid float64         `json:"defaultBid"`
	Raw        json.RawMessage `json:"-"`
}

func (c *Client) ListSPAdGroups(ctx context.Context, accessToken, profileID, baseURL string) ([]SPAdGroup, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/adGroups/list", "application/vnd.spAdGroup.v3+json", "adGroups")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPAdGroup, 0, len(raws))
	for _, raw := range raws {
		var a SPAdGroup
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, 0, fmt.Errorf("decode ad group: %w", err)
		}
		a.Raw = raw
		out = append(out, a)
	}
	return out, total, nil
}

// ── Keywords ────────────────────────────────────────────────────────────────

type SPKeyword struct {
	KeywordID   string          `json:"keywordId"`
	AdGroupID   string          `json:"adGroupId"`
	CampaignID  string          `json:"campaignId"`
	KeywordText string          `json:"keywordText"`
	MatchType   string          `json:"matchType"`
	State       string          `json:"state"`
	Bid         float64         `json:"bid"`
	Raw         json.RawMessage `json:"-"`
}

func (c *Client) ListSPKeywords(ctx context.Context, accessToken, profileID, baseURL string) ([]SPKeyword, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/keywords/list", "application/vnd.spKeyword.v3+json", "keywords")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPKeyword, 0, len(raws))
	for _, raw := range raws {
		var k SPKeyword
		if err := json.Unmarshal(raw, &k); err != nil {
			return nil, 0, fmt.Errorf("decode keyword: %w", err)
		}
		k.Raw = raw
		out = append(out, k)
	}
	return out, total, nil
}

// ── Product / category targets ───────────────────────────────────────────────

type SPTargetExpressionTerm struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type SPTarget struct {
	TargetID   string                   `json:"targetId"`
	AdGroupID  string                   `json:"adGroupId"`
	CampaignID string                   `json:"campaignId"`
	Expression []SPTargetExpressionTerm `json:"expression"`
	State      string                   `json:"state"`
	Bid        float64                  `json:"bid"`
	Raw        json.RawMessage          `json:"-"`
}

func (c *Client) ListSPTargets(ctx context.Context, accessToken, profileID, baseURL string) ([]SPTarget, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/targets/list", "application/vnd.spTargetingClause.v3+json", "targetingClauses")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPTarget, 0, len(raws))
	for _, raw := range raws {
		var t SPTarget
		if err := json.Unmarshal(raw, &t); err != nil {
			return nil, 0, fmt.Errorf("decode target: %w", err)
		}
		t.Raw = raw
		out = append(out, t)
	}
	return out, total, nil
}

// ── Negative keywords (ad-group level) ───────────────────────────────────────

type SPNegativeKeyword struct {
	KeywordID   string          `json:"keywordId"`
	AdGroupID   string          `json:"adGroupId"`
	CampaignID  string          `json:"campaignId"`
	KeywordText string          `json:"keywordText"`
	MatchType   string          `json:"matchType"`
	State       string          `json:"state"`
	Raw         json.RawMessage `json:"-"`
}

func (c *Client) ListSPNegativeKeywords(ctx context.Context, accessToken, profileID, baseURL string) ([]SPNegativeKeyword, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/negativeKeywords/list", "application/vnd.spNegativeKeyword.v3+json", "negativeKeywords")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPNegativeKeyword, 0, len(raws))
	for _, raw := range raws {
		var k SPNegativeKeyword
		if err := json.Unmarshal(raw, &k); err != nil {
			return nil, 0, fmt.Errorf("decode negative keyword: %w", err)
		}
		k.Raw = raw
		out = append(out, k)
	}
	return out, total, nil
}

// ── Negative keywords (campaign level) ───────────────────────────────────────

type SPCampaignNegativeKeyword struct {
	KeywordID   string          `json:"keywordId"`
	CampaignID  string          `json:"campaignId"`
	KeywordText string          `json:"keywordText"`
	MatchType   string          `json:"matchType"`
	State       string          `json:"state"`
	Raw         json.RawMessage `json:"-"`
}

func (c *Client) ListSPCampaignNegativeKeywords(ctx context.Context, accessToken, profileID, baseURL string) ([]SPCampaignNegativeKeyword, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/campaignNegativeKeywords/list", "application/vnd.spCampaignNegativeKeyword.v3+json", "campaignNegativeKeywords")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPCampaignNegativeKeyword, 0, len(raws))
	for _, raw := range raws {
		var k SPCampaignNegativeKeyword
		if err := json.Unmarshal(raw, &k); err != nil {
			return nil, 0, fmt.Errorf("decode campaign negative keyword: %w", err)
		}
		k.Raw = raw
		out = append(out, k)
	}
	return out, total, nil
}

// ── Negative targeting clauses (product/category) ────────────────────────────

type SPNegativeTarget struct {
	TargetID   string                   `json:"targetId"`
	AdGroupID  string                   `json:"adGroupId"`
	CampaignID string                   `json:"campaignId"`
	Expression []SPTargetExpressionTerm `json:"expression"`
	State      string                   `json:"state"`
	Raw        json.RawMessage          `json:"-"`
}

func (c *Client) ListSPNegativeTargets(ctx context.Context, accessToken, profileID, baseURL string) ([]SPNegativeTarget, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/negativeTargets/list", "application/vnd.spNegativeTargetingClause.v3+json", "negativeTargetingClauses")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPNegativeTarget, 0, len(raws))
	for _, raw := range raws {
		var t SPNegativeTarget
		if err := json.Unmarshal(raw, &t); err != nil {
			return nil, 0, fmt.Errorf("decode negative target: %w", err)
		}
		t.Raw = raw
		out = append(out, t)
	}
	return out, total, nil
}

// ── Product ads ───────────────────────────────────────────────────────────────

type SPProductAd struct {
	AdID       string          `json:"adId"`
	CampaignID string          `json:"campaignId"`
	AdGroupID  string          `json:"adGroupId"`
	ASIN       string          `json:"asin"`
	SKU        string          `json:"sku"`
	State      string          `json:"state"`
	Raw        json.RawMessage `json:"-"`
}

func (c *Client) ListSPProductAds(ctx context.Context, accessToken, profileID, baseURL string) ([]SPProductAd, int, error) {
	raws, total, err := listSPAll(ctx, c, accessToken, profileID, baseURL, "/sp/productAds/list", "application/vnd.spProductAd.v3+json", "productAds")
	if err != nil {
		return nil, 0, err
	}
	out := make([]SPProductAd, 0, len(raws))
	for _, raw := range raws {
		var a SPProductAd
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, 0, fmt.Errorf("decode product ad: %w", err)
		}
		a.Raw = raw
		out = append(out, a)
	}
	return out, total, nil
}

// ── Portfolios ────────────────────────────────────────────────────────────────
// Not Sponsored-Products-specific (portfolios span ad products). Verified
// live (not assumed): POST /portfolios/list with content-type
// application/vnd.portfolio.v3+json — the plain GET /v2/portfolios/extended
// this originally assumed 404s.

type SPPortfolioBudget struct {
	CurrencyCode string `json:"currencyCode"`
	Policy       string `json:"policy"`
}

type SPPortfolio struct {
	PortfolioID string            `json:"portfolioId"`
	Name        string            `json:"name"`
	State       string            `json:"state"`
	Budget      SPPortfolioBudget `json:"budget"`
	InBudget    bool              `json:"inBudget"`
	Raw         json.RawMessage   `json:"-"`
}

type portfoliosListRequest struct {
	MaxResults int    `json:"maxResults"`
	NextToken  string `json:"nextToken,omitempty"`
}

type portfoliosListResponse struct {
	Portfolios []json.RawMessage `json:"portfolios"`
	NextToken  string            `json:"nextToken"`
}

func (c *Client) ListPortfolios(ctx context.Context, accessToken, profileID, baseURL string) ([]SPPortfolio, error) {
	var all []SPPortfolio
	nextToken := ""
	firstPage := true

	for firstPage || nextToken != "" {
		firstPage = false
		reqBody := portfoliosListRequest{MaxResults: 100, NextToken: nextToken}

		page, err := withRetry(ctx, func() (*portfoliosListResponse, error) {
			bodyBytes, err := json.Marshal(reqBody)
			if err != nil {
				return nil, fmt.Errorf("marshal portfolios request: %w", err)
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/portfolios/list", bytes.NewReader(bodyBytes))
			if err != nil {
				return nil, fmt.Errorf("build portfolios request: %w", err)
			}
			req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
			req.Header.Set("Amazon-Advertising-API-Scope", profileID)
			req.Header.Set("Authorization", "Bearer "+accessToken)
			req.Header.Set("Content-Type", "application/vnd.portfolio.v3+json")
			req.Header.Set("Accept", "application/vnd.portfolio.v3+json")

			httpResp, err := c.httpClient.Do(req)
			if err != nil {
				return nil, &retryableError{fmt.Errorf("http: %w", err)}
			}
			defer httpResp.Body.Close()

			b, err := io.ReadAll(httpResp.Body)
			if err != nil {
				return nil, fmt.Errorf("read portfolios response: %w", err)
			}
			if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
				return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
			}
			if httpResp.StatusCode != http.StatusOK {
				return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
			}

			var resp portfoliosListResponse
			if err := json.Unmarshal(b, &resp); err != nil {
				return nil, fmt.Errorf("decode portfolios response: %w", err)
			}
			return &resp, nil
		})
		if err != nil {
			return nil, err
		}

		for _, raw := range page.Portfolios {
			var p SPPortfolio
			if err := json.Unmarshal(raw, &p); err != nil {
				return nil, fmt.Errorf("decode portfolio: %w", err)
			}
			p.Raw = raw
			all = append(all, p)
		}
		nextToken = page.NextToken
	}
	return all, nil
}

// ── Budget usage ──────────────────────────────────────────────────────────────
// D1/D5 both need a "hit budget cap" signal that nothing currently synced —
// this is that signal. Verified live (not assumed): POST /sp/campaigns/
// budget/usage with content-type application/vnd.spcampaignbudgetusage.v3+json
// (v1 404s — the version number matters) returns real data:
//
//	{"error": [], "success": [{"budget": 300.0, "budgetUsagePercent": 0.0,
//	  "campaignId": "234234987015772", "index": 0,
//	  "usageUpdatedTimestamp": "2026-08-11T07:00:00Z"}]}
//
// budgetUsagePercent hitting/near 100 while usageUpdatedTimestamp is recent
// is the real "out of budget" signal D1/D5 were missing — see
// sync/snapshot.go for where this gets captured.

type SPCampaignBudgetUsage struct {
	CampaignID            string          `json:"campaignId"`
	Budget                float64         `json:"budget"`
	BudgetUsagePercent    float64         `json:"budgetUsagePercent"`
	UsageUpdatedTimestamp string          `json:"usageUpdatedTimestamp"`
	Raw                   json.RawMessage `json:"-"`
}

type spBudgetUsageError struct {
	CampaignID string `json:"campaignId"`
	ErrorType  string `json:"errorType"`
	Message    string `json:"errorMessage"`
}

type budgetUsageRequest struct {
	CampaignIds []string `json:"campaignIds"`
}

type budgetUsageResponse struct {
	Success []json.RawMessage    `json:"success"`
	Error   []spBudgetUsageError `json:"error"`
}

// GetSPBudgetUsage returns per-campaign budget usage. Campaign ids Amazon
// couldn't resolve come back in the response's own "error" array rather than
// failing the whole call — surfaced via the second return value so a caller
// can log which ones and still use the campaigns that did resolve.
func (c *Client) GetSPBudgetUsage(ctx context.Context, accessToken, profileID, baseURL string, campaignIDs []string) ([]SPCampaignBudgetUsage, []spBudgetUsageError, error) {
	if len(campaignIDs) == 0 {
		return nil, nil, nil
	}
	result, err := withRetry(ctx, func() (*budgetUsageResponse, error) {
		bodyBytes, err := json.Marshal(budgetUsageRequest{CampaignIds: campaignIDs})
		if err != nil {
			return nil, fmt.Errorf("marshal budget usage request: %w", err)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/sp/campaigns/budget/usage", bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, fmt.Errorf("build budget usage request: %w", err)
		}
		req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
		req.Header.Set("Amazon-Advertising-API-Scope", profileID)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/vnd.spcampaignbudgetusage.v3+json")
		req.Header.Set("Accept", "application/vnd.spcampaignbudgetusage.v3+json")

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, err := io.ReadAll(httpResp.Body)
		if err != nil {
			return nil, fmt.Errorf("read budget usage response: %w", err)
		}
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}

		var resp budgetUsageResponse
		if err := json.Unmarshal(b, &resp); err != nil {
			return nil, fmt.Errorf("decode budget usage response: %w", err)
		}
		return &resp, nil
	})
	if err != nil {
		return nil, nil, err
	}

	out := make([]SPCampaignBudgetUsage, 0, len(result.Success))
	for _, raw := range result.Success {
		var u SPCampaignBudgetUsage
		if err := json.Unmarshal(raw, &u); err != nil {
			return nil, nil, fmt.Errorf("decode budget usage entry: %w", err)
		}
		u.Raw = raw
		out = append(out, u)
	}
	return out, result.Error, nil
}
