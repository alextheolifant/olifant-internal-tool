package sync

import (
	"context"
	"log"

	"olifant/sync-ads-api/internal/amazon"
	"olifant/sync-ads-api/internal/db"
	"olifant/sync-ads-api/internal/tokencrypto"
)

// buildTokenManagers constructs one amazon.Client/TokenManager per active
// manager account, keyed by ads_manager_account_id. A manager account whose
// token can't be decrypted is simply omitted from the map — callers treat a
// missing map entry as a per-account failure (see each orchestrator's
// syncAccount-style method), so this never blocks accounts under other
// manager accounts. logPrefix matches the caller's existing log style
// ("[campaigns]" / "[metrics]").
func buildTokenManagers(
	ctx context.Context,
	writer *db.Writer,
	clientID, clientSecret string,
	encryptionKey []byte,
	logPrefix string,
) map[string]*amazon.TokenManager {
	managerAccounts, err := writer.FetchActiveManagerAccounts(ctx)
	if err != nil {
		log.Printf("%s fetch active manager accounts failed: %v", logPrefix, err)
		return map[string]*amazon.TokenManager{}
	}

	tokenManagers := make(map[string]*amazon.TokenManager, len(managerAccounts))
	for _, ma := range managerAccounts {
		refreshToken, err := tokencrypto.Decrypt(encryptionKey, ma.EncryptedRefreshToken)
		if err != nil {
			log.Printf("%s manager account %s: decrypt failed, skipping: %v", logPrefix, ma.ID, err)
			continue
		}
		client := amazon.NewClient(clientID, clientSecret, refreshToken)
		tokenManagers[ma.ID] = amazon.NewTokenManager(client)
	}
	return tokenManagers
}
