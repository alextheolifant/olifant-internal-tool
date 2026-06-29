package amazon

// Client handles communication with the Amazon SP-API.
// Implements exponential backoff and retry on rate-limit errors.
type Client struct {
	clientID     string
	clientSecret string
	refreshToken string
	marketplaceID string
}

func NewClient(clientID, clientSecret, refreshToken, marketplaceID string) *Client {
	return &Client{
		clientID:      clientID,
		clientSecret:  clientSecret,
		refreshToken:  refreshToken,
		marketplaceID: marketplaceID,
	}
}
