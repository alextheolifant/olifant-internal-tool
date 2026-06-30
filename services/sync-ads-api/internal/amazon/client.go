package amazon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	tokenURL    = "https://api.amazon.com/auth/o2/token"
	profilesURL = "https://advertising-api.amazon.com/v2/profiles"

	maxRetries  = 3
	baseBackoff = 500 * time.Millisecond
)

// Client handles communication with the Amazon Advertising API.
// Implements exponential backoff and retry on rate-limit/transient errors.
type Client struct {
	clientID     string
	clientSecret string
	refreshToken string
	httpClient   *http.Client
}

func NewClient(clientID, clientSecret, refreshToken string) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		refreshToken: refreshToken,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

// TokenResponse is the response body from the Login with Amazon token endpoint.
type TokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
}

// AccountInfo is the nested accountInfo object on a Profile.
type AccountInfo struct {
	MarketplaceStringID string `json:"marketplaceStringId"`
	ID                  string `json:"id"`
	Type                string `json:"type"`
	Name                string `json:"name"`
}

// Profile is a single advertising profile as returned by GET /v2/profiles.
type Profile struct {
	ProfileID    int64       `json:"profileId"`
	CountryCode  string      `json:"countryCode"`
	CurrencyCode string      `json:"currencyCode"`
	Timezone     string      `json:"timezone"`
	AccountInfo  AccountInfo `json:"accountInfo"`
}

// retryableError marks an error as worth retrying (429 or 5xx).
type retryableError struct{ err error }

func (e *retryableError) Error() string { return e.err.Error() }
func (e *retryableError) Unwrap() error { return e.err }

// withRetry calls fn up to maxRetries+1 times, backing off exponentially
// (500ms, 1s, 2s) between attempts. Only errors wrapped as *retryableError
// trigger a retry; any other error returns immediately.
func withRetry[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var zero T
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(float64(baseBackoff) * math.Pow(2, float64(attempt-1)))
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return zero, ctx.Err()
			}
		}

		result, err := fn()
		if err == nil {
			return result, nil
		}

		var re *retryableError
		if !asRetryable(err, &re) {
			return zero, err
		}
		lastErr = re.err
	}

	return zero, fmt.Errorf("exceeded %d retries: %w", maxRetries, lastErr)
}

func asRetryable(err error, target **retryableError) bool {
	re, ok := err.(*retryableError)
	if ok {
		*target = re
	}
	return ok
}

// ExchangeRefreshToken trades the long-lived refresh token for a short-lived
// access token via Login with Amazon.
func (c *Client) ExchangeRefreshToken(ctx context.Context) (*TokenResponse, error) {
	return withRetry(ctx, func() (*TokenResponse, error) {
		form := url.Values{
			"grant_type":    {"refresh_token"},
			"refresh_token": {c.refreshToken},
			"client_id":     {c.clientID},
			"client_secret": {c.clientSecret},
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
		if err != nil {
			return nil, fmt.Errorf("build token request: %w", err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("token request failed: %w", err)}
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read token response: %w", err)
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, body)}
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, body)
		}

		var tok TokenResponse
		if err := json.Unmarshal(body, &tok); err != nil {
			return nil, fmt.Errorf("decode token response: %w", err)
		}
		return &tok, nil
	})
}

// ListProfiles fetches every advertising profile accessible to the
// authenticated developer account.
func (c *Client) ListProfiles(ctx context.Context, accessToken string) ([]Profile, error) {
	return withRetry(ctx, func() ([]Profile, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, profilesURL, nil)
		if err != nil {
			return nil, fmt.Errorf("build profiles request: %w", err)
		}
		req.Header.Set("Amazon-Advertising-API-ClientId", c.clientID)
		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("profiles request failed: %w", err)}
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read profiles response: %w", err)
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("profiles endpoint returned %d: %s", resp.StatusCode, body)}
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("profiles endpoint returned %d: %s", resp.StatusCode, body)
		}

		var profiles []Profile
		if err := json.Unmarshal(body, &profiles); err != nil {
			return nil, fmt.Errorf("decode profiles response: %w", err)
		}
		return profiles, nil
	})
}
