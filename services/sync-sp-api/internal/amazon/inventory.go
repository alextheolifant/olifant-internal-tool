package amazon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// InventoryDetails is the nested quantity breakdown on one inventorySummaries entry.
type InventoryDetails struct {
	FulfillableQuantity int `json:"fulfillableQuantity"`
}

// InventorySummary is one row of GET /fba/inventory/v1/summaries.
type InventorySummary struct {
	ASIN             string           `json:"asin"`
	SellerSKU        string           `json:"sellerSku"`
	InventoryDetails InventoryDetails `json:"inventoryDetails"`
	TotalQuantity    int              `json:"totalQuantity"`
}

type inventoryAPIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details"`
}

type inventoryResponse struct {
	Payload struct {
		InventorySummaries []InventorySummary `json:"inventorySummaries"`
	} `json:"payload"`
	Pagination struct {
		NextToken string `json:"nextToken"`
	} `json:"pagination"`
	Errors []inventoryAPIError `json:"errors"`
}

// inventoryPage bundles the multi-value result so it fits withRetry's single
// type parameter T.
type inventoryPage struct {
	Summaries []InventorySummary
	NextToken string
}

// GetInventorySummaries fetches one page of aggregated (details=false) FBA
// inventory for a marketplace. Pass nextToken="" for the first page.
// granularityId is the marketplaceId — VERIFIED required alongside
// granularityType and marketplaceIds; calling without them 400s.
func (c *Client) GetInventorySummaries(ctx context.Context, accessToken string, region Region, marketplaceID, nextToken string) ([]InventorySummary, string, error) {
	page, err := withRetry(ctx, func() (inventoryPage, error) {
		q := url.Values{
			"details":         {"false"},
			"granularityType": {"Marketplace"},
			"granularityId":   {marketplaceID},
			"marketplaceIds":  {marketplaceID},
		}
		if nextToken != "" {
			q.Set("nextToken", nextToken)
		}

		reqURL := region.BaseURL + "/fba/inventory/v1/summaries?" + q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return inventoryPage{}, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("x-amz-access-token", accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return inventoryPage{}, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return inventoryPage{}, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return inventoryPage{}, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}

		var resp inventoryResponse
		if err := json.Unmarshal(b, &resp); err != nil {
			return inventoryPage{}, fmt.Errorf("decode response: %w", err)
		}
		for _, apiErr := range resp.Errors {
			// Amazon can return partial errors alongside a 200 — surface, don't silently drop.
			return inventoryPage{}, fmt.Errorf("inventory api error %s: %s", apiErr.Code, apiErr.Message)
		}
		return inventoryPage{Summaries: resp.Payload.InventorySummaries, NextToken: resp.Pagination.NextToken}, nil
	})
	if err != nil {
		return nil, "", err
	}
	return page.Summaries, page.NextToken, nil
}
