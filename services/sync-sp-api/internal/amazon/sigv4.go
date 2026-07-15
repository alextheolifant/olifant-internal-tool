package amazon

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// signingService is the SigV4 service name SP-API expects (it sits behind API
// Gateway, like most restricted-data AWS-fronted APIs) — VERIFY against a real
// signed call during testing, per the same caution the task doc applies to
// other undocumented specifics.
const signingService = "execute-api"

// RequestSigner produces AWS SigV4 signatures for SP-API requests using
// temporary credentials obtained by assuming OlifantSPAPIRole. One instance
// is shared across all accounts/regions — STS AssumeRole credentials are not
// seller-specific, only the LWA access token (TokenManager) is.
type RequestSigner struct {
	creds  *aws.CredentialsCache
	signer *v4.Signer
}

// NewRequestSigner builds a signer backed by stscreds.NewAssumeRoleProvider:
// the static IAM user (accessKeyID/secretAccessKey) assumes roleARN to obtain
// short-lived credentials, cached and auto-refreshed by aws.CredentialsCache.
func NewRequestSigner(ctx context.Context, accessKeyID, secretAccessKey, roleARN, awsRegion string) (*RequestSigner, error) {
	staticCfg := aws.Config{
		Credentials: credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		Region:      awsRegion,
	}
	stsClient := sts.NewFromConfig(staticCfg)
	provider := stscreds.NewAssumeRoleProvider(stsClient, roleARN)
	cache := aws.NewCredentialsCache(provider)

	// Fail fast if the role can't actually be assumed, rather than on the
	// first real SP-API call deep inside a sync run.
	if _, err := cache.Retrieve(ctx); err != nil {
		return nil, fmt.Errorf("assume role %s: %w", roleARN, err)
	}

	return &RequestSigner{creds: cache, signer: v4.NewSigner()}, nil
}

// Sign signs req in place for the given region using body's SHA-256 hash
// (pass nil for a bodyless GET request).
func (s *RequestSigner) Sign(ctx context.Context, req *http.Request, body []byte, awsRegion string) error {
	creds, err := s.creds.Retrieve(ctx)
	if err != nil {
		return fmt.Errorf("retrieve credentials: %w", err)
	}

	sum := sha256.Sum256(body)
	payloadHash := hex.EncodeToString(sum[:])

	if err := s.signer.SignHTTP(ctx, creds, req, payloadHash, signingService, awsRegion, time.Now()); err != nil {
		return fmt.Errorf("sign request: %w", err)
	}
	return nil
}
