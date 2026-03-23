package plugin

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// TokenEntry holds a cached OAuth token for a specific user/tenant combination.
type TokenEntry struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	TokenType    string    `json:"token_type"`
	ExpiresAt    time.Time `json:"expires_at"`
	TenantID     string    `json:"tenant_id"`
}

// IsExpired returns true if the token is expired or will expire within the buffer period.
func (t *TokenEntry) IsExpired() bool {
	// Consider expired 30 seconds before actual expiry to avoid race conditions
	return time.Now().After(t.ExpiresAt.Add(-30 * time.Second))
}

// PendingAuth tracks an in-progress OAuth authorization flow.
type PendingAuth struct {
	State        string
	CodeVerifier string
	TenantID     string
	UserLogin    string
	RedirectURI  string
	CreatedAt    time.Time
}

// tokenResponse is the JSON response from the token endpoint.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error,omitempty"`
	ErrorDesc    string `json:"error_description,omitempty"`
}

// TokenManager handles OAuth token acquisition, caching, and refresh.
type TokenManager struct {
	// tokens stores TokenEntry keyed by "userLogin:tenantId"
	tokens sync.Map
	// pendingFlows stores PendingAuth keyed by state parameter
	pendingFlows sync.Map
	logger       log.Logger
}

// NewTokenManager creates a new TokenManager.
func NewTokenManager(logger log.Logger) *TokenManager {
	tm := &TokenManager{
		logger: logger,
	}
	// Start cleanup goroutine for expired pending flows
	go tm.cleanupPendingFlows()
	return tm
}

func tokenKey(userLogin, tenantID string) string {
	return userLogin + ":" + tenantID
}

// GetToken returns a valid token for the user/tenant, or nil if not available.
// If the token is expired but has a refresh token, it attempts to refresh.
func (tm *TokenManager) GetToken(userLogin, tenantID string, settings *Settings) (*TokenEntry, error) {
	key := tokenKey(userLogin, tenantID)
	val, ok := tm.tokens.Load(key)
	if !ok {
		return nil, nil
	}

	entry := val.(*TokenEntry)
	if !entry.IsExpired() {
		return entry, nil
	}

	// Token expired — try refresh
	if entry.RefreshToken != "" {
		refreshed, err := tm.refreshToken(entry, settings)
		if err != nil {
			tm.logger.Warn("Token refresh failed, removing cached token", "user", userLogin, "tenant", tenantID, "error", err)
			tm.tokens.Delete(key)
			return nil, nil
		}
		tm.tokens.Store(key, refreshed)
		return refreshed, nil
	}

	// No refresh token, remove expired entry
	tm.tokens.Delete(key)
	return nil, nil
}

// HasToken returns whether a valid (or refreshable) token exists for the user/tenant.
func (tm *TokenManager) HasToken(userLogin, tenantID string) bool {
	key := tokenKey(userLogin, tenantID)
	val, ok := tm.tokens.Load(key)
	if !ok {
		return false
	}
	entry := val.(*TokenEntry)
	return !entry.IsExpired() || entry.RefreshToken != ""
}

// StartAuth initiates an OAuth authorization flow and returns the authorize URL.
func (tm *TokenManager) StartAuth(userLogin, tenantID string, settings *Settings, callbackURL string) (string, error) {
	if settings.IdentityServerURL == "" {
		return "", fmt.Errorf("identity server URL is not configured")
	}
	if settings.OAuthClientID == "" {
		return "", fmt.Errorf("OAuth client ID is not configured")
	}

	state, err := generateRandomString(32)
	if err != nil {
		return "", fmt.Errorf("failed to generate state: %w", err)
	}

	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		return "", fmt.Errorf("failed to generate code verifier: %w", err)
	}

	codeChallenge := generateCodeChallenge(codeVerifier)

	pending := &PendingAuth{
		State:        state,
		CodeVerifier: codeVerifier,
		TenantID:     tenantID,
		UserLogin:    userLogin,
		RedirectURI:  callbackURL,
		CreatedAt:    time.Now(),
	}
	tm.pendingFlows.Store(state, pending)

	scopes := settings.OAuthScopes
	if scopes == "" {
		scopes = "openid profile email assetTenantAPI.full_access offline_access"
	}

	authorizeURL := fmt.Sprintf("%s/connect/authorize", strings.TrimRight(settings.IdentityServerURL, "/"))

	params := url.Values{
		"client_id":             {settings.OAuthClientID},
		"response_type":        {"code"},
		"redirect_uri":         {callbackURL},
		"scope":                {scopes},
		"state":                {state},
		"code_challenge":       {codeChallenge},
		"code_challenge_method": {"S256"},
		"acr_values":           {fmt.Sprintf("tenant:%s", tenantID)},
	}

	return authorizeURL + "?" + params.Encode(), nil
}

// HandleCallback processes the OAuth callback, exchanges the code for tokens, and caches the result.
func (tm *TokenManager) HandleCallback(state, code string, settings *Settings) (*TokenEntry, error) {
	val, ok := tm.pendingFlows.LoadAndDelete(state)
	if !ok {
		return nil, fmt.Errorf("unknown or expired state parameter")
	}

	pending := val.(*PendingAuth)

	// Check if the pending flow is too old (10 minute max)
	if time.Since(pending.CreatedAt) > 10*time.Minute {
		return nil, fmt.Errorf("authorization flow expired")
	}

	tokenURL := fmt.Sprintf("%s/connect/token", strings.TrimRight(settings.IdentityServerURL, "/"))

	params := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {settings.OAuthClientID},
		"code":          {code},
		"redirect_uri":  {pending.RedirectURI},
		"code_verifier": {pending.CodeVerifier},
	}

	entry, err := tm.doTokenRequest(tokenURL, params, settings.TLSSkipVerify)
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}

	entry.TenantID = pending.TenantID

	key := tokenKey(pending.UserLogin, pending.TenantID)
	tm.tokens.Store(key, entry)

	tm.logger.Info("Token acquired", "user", pending.UserLogin, "tenant", pending.TenantID)
	return entry, nil
}

// refreshToken uses the refresh token to obtain a new access token.
func (tm *TokenManager) refreshToken(entry *TokenEntry, settings *Settings) (*TokenEntry, error) {
	tokenURL := fmt.Sprintf("%s/connect/token", strings.TrimRight(settings.IdentityServerURL, "/"))

	params := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {settings.OAuthClientID},
		"refresh_token": {entry.RefreshToken},
	}

	newEntry, err := tm.doTokenRequest(tokenURL, params, settings.TLSSkipVerify)
	if err != nil {
		return nil, err
	}

	newEntry.TenantID = entry.TenantID

	// If the new response doesn't include a refresh token, keep the old one
	if newEntry.RefreshToken == "" {
		newEntry.RefreshToken = entry.RefreshToken
	}

	return newEntry, nil
}

// doTokenRequest performs a POST to the token endpoint and parses the response.
func (tm *TokenManager) doTokenRequest(tokenURL string, params url.Values, tlsSkipVerify bool) (*TokenEntry, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	if tlsSkipVerify {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // User-configured for dev environments
		}
	}

	resp, err := client.PostForm(tokenURL, params)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read token response: %w", err)
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	if tokenResp.Error != "" {
		return nil, fmt.Errorf("token error: %s - %s", tokenResp.Error, tokenResp.ErrorDesc)
	}

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("token response missing access_token (HTTP %d)", resp.StatusCode)
	}

	expiresIn := tokenResp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600 // Default 1 hour
	}

	return &TokenEntry{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresAt:    time.Now().Add(time.Duration(expiresIn) * time.Second),
		TenantID:     "",
	}, nil
}

// cleanupPendingFlows removes expired pending authorization flows every minute.
func (tm *TokenManager) cleanupPendingFlows() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		tm.pendingFlows.Range(func(key, value interface{}) bool {
			pending := value.(*PendingAuth)
			if time.Since(pending.CreatedAt) > 10*time.Minute {
				tm.pendingFlows.Delete(key)
			}
			return true
		})
	}
}

// PKCE helpers

// generateRandomString generates a cryptographically random URL-safe string.
func generateRandomString(length int) (string, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b)[:length], nil
}

// generateCodeVerifier generates a PKCE code verifier (43-128 chars, RFC 7636).
func generateCodeVerifier() (string, error) {
	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// generateCodeChallenge creates a PKCE S256 code challenge from a code verifier.
func generateCodeChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
