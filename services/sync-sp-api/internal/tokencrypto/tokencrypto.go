// Package tokencrypto decrypts amazon_sp_accounts.refresh_token, which
// apps/api (NestJS, common/crypto.util.ts) encrypts with AES-256-GCM using
// the same SP_TOKEN_ENCRYPTION_KEY. Ciphertext layout: base64(iv[12] ||
// authTag[16] || ciphertext) — Go's cipher.AEAD.Seal/Open expect the tag
// appended to the END of the ciphertext, so bytes are reordered accordingly
// on both encode and decode to stay wire-compatible with the Node side.
package tokencrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

const (
	ivLength      = 12
	authTagLength = 16
)

// Decrypt reverses Encrypt/apps/api's encrypt(): input is
// base64(iv || authTag || ciphertext); output is the original plaintext.
func Decrypt(key []byte, payload string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}

	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("decode base64 payload: %w", err)
	}
	if len(raw) < ivLength+authTagLength {
		return "", fmt.Errorf("ciphertext too short: %d bytes", len(raw))
	}

	iv := raw[:ivLength]
	authTag := raw[ivLength : ivLength+authTagLength]
	ciphertext := raw[ivLength+authTagLength:]

	// Go's GCM expects ciphertext||tag, not iv||tag||ciphertext — reassemble.
	ciphertextAndTag := append(append([]byte{}, ciphertext...), authTag...)

	plaintext, err := gcm.Open(nil, iv, ciphertextAndTag, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plaintext), nil
}

// Encrypt mirrors apps/api's encrypt() byte-for-byte, kept for round-trip
// testing against the Node implementation (Go itself only ever decrypts —
// refresh tokens are written once, by NestJS, at OAuth callback time).
func Encrypt(key []byte, plaintext string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}

	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("generate iv: %w", err)
	}

	ciphertextAndTag := gcm.Seal(nil, iv, []byte(plaintext), nil)
	split := len(ciphertextAndTag) - authTagLength
	ciphertext, authTag := ciphertextAndTag[:split], ciphertextAndTag[split:]

	out := make([]byte, 0, ivLength+authTagLength+len(ciphertext))
	out = append(out, iv...)
	out = append(out, authTag...)
	out = append(out, ciphertext...)
	return base64.StdEncoding.EncodeToString(out), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create gcm: %w", err)
	}
	return gcm, nil
}
