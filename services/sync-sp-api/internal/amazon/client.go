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
	"sync"
	"time"
)

const (
	tokenURL    = "https://api.amazon.com/auth/o2/token"
	maxRetries  = 3
	baseBackoff = 500 * time.Millisecond
)

// Region represents one of Amazon's three SP-API regional endpoints. These
// are DIFFERENT hosts from the Advertising API's regional endpoints — do not
// conflate the two, even though the na/eu/fe grouping concept is the same.
type Region struct {
	Name      string
	BaseURL   string
	AWSRegion string // SigV4 signing region for this SP-API region
}

// Regions is the canonical list. NA covers US/CA/MX/BR; EU covers UK/DE/FR
// and others; FE covers JP/AU/SG.
var Regions = []Region{
	{Name: "na", BaseURL: "https://sellingpartnerapi-na.amazon.com", AWSRegion: "us-east-1"},
	{Name: "eu", BaseURL: "https://sellingpartnerapi-eu.amazon.com", AWSRegion: "eu-west-1"},
	{Name: "fe", BaseURL: "https://sellingpartnerapi-fe.amazon.com", AWSRegion: "us-west-2"},
}

// RegionByName returns the Region for a stored region string ('na', 'eu', 'fe').
// Defaults to NA if unrecognised.
func RegionByName(region string) Region {
	for _, r := range Regions {
		if r.Name == region {
			return r
		}
	}
	return Regions[0]
}

// Client handles communication with the Amazon SP-API. Every data-plane call
// needs both an LWA access token (this file) and an AWS SigV4 signature
// (sigv4.go) — unlike the Advertising API, a bearer token alone is not enough.
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

// ExchangeRefreshToken trades the seller's long-lived refresh token for a
// short-lived access token via Login with Amazon. This is a per-seller call —
// each amazon_sp_accounts row has its own refresh token, unlike the
// Advertising API's single app-level token.
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

// TokenManager caches one seller's access token and refreshes it when < 60s
// remain. One instance per amazon_sp_accounts row — refresh tokens are
// per-seller, so tokens cannot be shared across accounts like the Ads API can.
type TokenManager struct {
	client      *Client
	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func NewTokenManager(c *Client) *TokenManager {
	return &TokenManager{client: c}
}

func (tm *TokenManager) Token(ctx context.Context) (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tm.accessToken != "" && time.Until(tm.expiresAt) > 60*time.Second {
		return tm.accessToken, nil
	}
	tok, err := tm.client.ExchangeRefreshToken(ctx)
	if err != nil {
		return "", fmt.Errorf("refresh access token: %w", err)
	}
	tm.accessToken = tok.AccessToken
	tm.expiresAt = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return tm.accessToken, nil
}
