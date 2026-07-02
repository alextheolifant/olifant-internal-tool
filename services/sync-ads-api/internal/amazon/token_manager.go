package amazon

import (
	"context"
	"sync"
	"time"
)

// TokenManager wraps Client and caches the access token, refreshing it
// automatically when fewer than 60 seconds remain before expiry.
type TokenManager struct {
	client      *Client
	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func NewTokenManager(client *Client) *TokenManager {
	return &TokenManager{client: client}
}

// AccessToken returns a valid access token, refreshing if needed.
func (tm *TokenManager) AccessToken(ctx context.Context) (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if tm.accessToken != "" && time.Until(tm.expiresAt) > 60*time.Second {
		return tm.accessToken, nil
	}

	tok, err := tm.client.ExchangeRefreshToken(ctx)
	if err != nil {
		return "", err
	}

	tm.accessToken = tok.AccessToken
	tm.expiresAt = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return tm.accessToken, nil
}
