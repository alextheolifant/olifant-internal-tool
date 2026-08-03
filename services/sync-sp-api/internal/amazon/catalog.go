package amazon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// MaxCatalogIdentifiersPerCall caps how many ASINs go into one `identifiers`
// lookup. TODO(unverified): this endpoint has not been called against a real
// account yet — 20 matches Amazon's documented per-call identifier limit for
// Catalog Items 2022-04-01, but confirm against a live response before
// trusting it, per the task's own caveat.
const MaxCatalogIdentifiersPerCall = 20

// CatalogItemSummary is one entry in an item's `summaries` array — one per
// marketplace the ASIN is listed in.
//
// TODO(unverified): field paths assumed from SP-API docs, not confirmed
// against a live response. In particular, "status" may not exist on
// `summaries` the way this assumes — Catalog Items 2022-04-01 might carry
// item state under a different includedData block entirely (e.g.
// `attributes` or a separate endpoint). Verify with a real account and
// correct this shape before relying on it.
type CatalogItemSummary struct {
	MarketplaceID string `json:"marketplaceId"`
	ItemName      string `json:"itemName"`
	Status        string `json:"status"`
}

// CatalogItem is one entry in the /catalog/2022-04-01/items response's
// `items` array.
type CatalogItem struct {
	ASIN      string               `json:"asin"`
	Summaries []CatalogItemSummary `json:"summaries"`
}

type catalogAPIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details"`
}

type catalogItemsResponse struct {
	NumberOfResults int    `json:"numberOfResults"`
	Pagination      struct {
		NextToken string `json:"nextToken"`
	} `json:"pagination"`
	Items  []CatalogItem     `json:"items"`
	Errors []catalogAPIError `json:"errors"`
}

type catalogItemsPage struct {
	Items     []CatalogItem
	NextToken string
}

// GetCatalogItems looks up product summaries for up to
// MaxCatalogIdentifiersPerCall ASINs in one call. Callers must chunk larger
// ASIN lists themselves.
func (c *Client) GetCatalogItems(ctx context.Context, accessToken string, region Region, marketplaceID string, asins []string, nextToken string) ([]CatalogItem, string, error) {
	page, err := withRetry(ctx, func() (catalogItemsPage, error) {
		q := url.Values{
			"identifiers":     {strings.Join(asins, ",")},
			"identifiersType": {"ASIN"},
			"marketplaceIds":  {marketplaceID},
			"includedData":    {"summaries"},
		}
		if nextToken != "" {
			q.Set("pageToken", nextToken)
		}

		reqURL := region.BaseURL + "/catalog/2022-04-01/items?" + q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return catalogItemsPage{}, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("x-amz-access-token", accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return catalogItemsPage{}, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return catalogItemsPage{}, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return catalogItemsPage{}, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}

		var resp catalogItemsResponse
		if err := json.Unmarshal(b, &resp); err != nil {
			return catalogItemsPage{}, fmt.Errorf("decode response: %w", err)
		}
		for _, apiErr := range resp.Errors {
			// Amazon can return partial errors alongside a 200 — surface, don't silently drop.
			return catalogItemsPage{}, fmt.Errorf("catalog items api error %s: %s", apiErr.Code, apiErr.Message)
		}
		return catalogItemsPage{Items: resp.Items, NextToken: resp.Pagination.NextToken}, nil
	})
	if err != nil {
		return nil, "", err
	}
	return page.Items, page.NextToken, nil
}

// ExtractNameAndStatus pulls the product title and status out of an item's
// first summary. Amazon returns one summary per marketplace the item is
// tracked in — since every call here is scoped to a single marketplaceID,
// the first (only) summary is the relevant one. Returns ("", "") if the item
// has no summaries at all (e.g. the ASIN isn't found in this marketplace).
func ExtractNameAndStatus(item CatalogItem) (name string, status string) {
	if len(item.Summaries) == 0 {
		return "", ""
	}
	return item.Summaries[0].ItemName, item.Summaries[0].Status
}

// ChunkASINs splits a flat ASIN list into batches no larger than
// MaxCatalogIdentifiersPerCall.
func ChunkASINs(asins []string) [][]string {
	if len(asins) == 0 {
		return nil
	}
	chunks := make([][]string, 0, (len(asins)+MaxCatalogIdentifiersPerCall-1)/MaxCatalogIdentifiersPerCall)
	for i := 0; i < len(asins); i += MaxCatalogIdentifiersPerCall {
		end := min(i+MaxCatalogIdentifiersPerCall, len(asins))
		chunks = append(chunks, asins[i:end])
	}
	return chunks
}
