package amazon

// Client handles communication with the Amazon Advertising API.
// Implements exponential backoff and retry on rate-limit errors.
type Client struct {
	clientID     string
	clientSecret string
	refreshToken string
	profileID    string
}

func NewClient(clientID, clientSecret, refreshToken, profileID string) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		refreshToken: refreshToken,
		profileID:    profileID,
	}
}
