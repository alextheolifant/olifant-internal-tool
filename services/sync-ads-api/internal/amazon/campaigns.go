package amazon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const spCampaignsPath = "/sp/campaigns/list"

// SPBudget is the nested budget object in the SP campaigns response.
type SPBudget struct {
	Budget     float64 `json:"budget"`
	BudgetType string  `json:"budgetType"`
}

// SPDynamicBidding holds the bidding strategy for a campaign.
type SPDynamicBidding struct {
	Strategy string `json:"strategy"`
}

// SPCampaign is a single Sponsored Products campaign as returned by the API.
type SPCampaign struct {
	CampaignID     string           `json:"campaignId"`
	Name           string           `json:"name"`
	State          string           `json:"state"`
	Budget         SPBudget         `json:"budget"`
	TargetingType  string           `json:"targetingType"`
	StartDate      string           `json:"startDate"`
	PortfolioID    string           `json:"portfolioId"`
	DynamicBidding SPDynamicBidding `json:"dynamicBidding"`
	// Raw holds the full unmarshalled object for storage in raw_data.
	Raw json.RawMessage `json:"-"`
}

type spCampaignsResponse struct {
	Campaigns    []json.RawMessage `json:"campaigns"`
	NextToken    string            `json:"nextToken"`
	TotalResults int               `json:"totalResults"`
}

type spCampaignsRequest struct {
	StateFilter struct {
		Include []string `json:"include"`
	} `json:"stateFilter"`
	MaxResults int    `json:"maxResults"`
	NextToken  string `json:"nextToken,omitempty"`
}

// ListSPCampaigns fetches all Sponsored Products campaigns for the given
// profileID, handling pagination automatically. Returns the parsed campaigns,
// the totalResults count reported by the API, and any error.
//
// TODO: add ListSBCampaigns (/sb/campaigns/list) and
// ListSDCampaigns (/sd/campaigns/list) following the same pattern.
func (c *Client) ListSPCampaigns(ctx context.Context, accessToken, profileID, baseURL string) ([]SPCampaign, int, error) {
	var (
		all          []SPCampaign
		totalResults int
		nextToken    string
		firstPage    = true
	)

	for firstPage || nextToken != "" {
		firstPage = false

		reqBody := spCampaignsRequest{MaxResults: 100}
		reqBody.StateFilter.Include = []string{"ENABLED", "PAUSED"}
		if nextToken != "" {
			reqBody.NextToken = nextToken
		}

		page, err := withRetry(ctx, func() (*spCampaignsResponse, error) {
			return c.doSPCampaignsPage(ctx, accessToken, profileID, baseURL, reqBody)
		})
		if err != nil {
			return nil, 0, err
		}

		totalResults = page.TotalResults
		nextToken = page.NextToken

		for _, raw := range page.Campaigns {
			var camp SPCampaign
			if err := json.Unmarshal(raw, &camp); err != nil {
				return nil, 0, fmt.Errorf("decode campaign: %w", err)
			}
			camp.Raw = raw
			all = append(all, camp)
		}
	}

	return all, totalResults, nil
}

func (c *Client) doSPCampaignsPage(ctx context.Context, accessToken, profileID, baseURL string, reqBody spCampaignsRequest) (*spCampaignsResponse, error) {
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal campaigns request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+spCampaignsPath, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build campaigns request: %w", err)
	}
	req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
	req.Header.Set("Amazon-Advertising-API-Scope", profileID)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/vnd.spCampaign.v3+json")
	req.Header.Set("Accept", "application/vnd.spCampaign.v3+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, &retryableError{fmt.Errorf("campaigns request failed: %w", err)}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read campaigns response: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return nil, &retryableError{fmt.Errorf("campaigns endpoint returned %d: %s", resp.StatusCode, body)}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("campaigns endpoint returned %d: %s", resp.StatusCode, body)
	}

	var page spCampaignsResponse
	if err := json.Unmarshal(body, &page); err != nil {
		return nil, fmt.Errorf("decode campaigns response: %w", err)
	}
	return &page, nil
}
