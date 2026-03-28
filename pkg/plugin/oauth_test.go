package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestTokenManager() *TokenManager {
	return &TokenManager{
		logger:      log.DefaultLogger,
		stopCleanup: make(chan struct{}),
	}
}

func TestGenerateCodeVerifier(t *testing.T) {
	verifier, err := generateCodeVerifier()
	require.NoError(t, err)
	// RFC 7636: 43-128 characters
	assert.GreaterOrEqual(t, len(verifier), 43)
	assert.LessOrEqual(t, len(verifier), 128)
}

func TestGenerateCodeChallenge(t *testing.T) {
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	challenge := generateCodeChallenge(verifier)
	assert.NotEmpty(t, challenge)
	// Challenge should be base64url encoded without padding
	assert.NotContains(t, challenge, "=")
	assert.NotContains(t, challenge, "+")
	assert.NotContains(t, challenge, "/")
}

func TestTokenEntryIsExpired(t *testing.T) {
	t.Run("not expired", func(t *testing.T) {
		entry := &TokenEntry{
			ExpiresAt: time.Now().Add(5 * time.Minute),
		}
		assert.False(t, entry.IsExpired())
	})

	t.Run("expired", func(t *testing.T) {
		entry := &TokenEntry{
			ExpiresAt: time.Now().Add(-1 * time.Minute),
		}
		assert.True(t, entry.IsExpired())
	})

	t.Run("within 30s buffer", func(t *testing.T) {
		entry := &TokenEntry{
			ExpiresAt: time.Now().Add(20 * time.Second),
		}
		assert.True(t, entry.IsExpired())
	})
}

func TestStartAuth(t *testing.T) {
	tm := newTestTokenManager()
	settings := &Settings{
		TenantID:          "meshtest",
		IdentityServerURL: "https://connect.example.com",
		OAuthClientID:     "grafana-datasource",
		OAuthScopes:       "openid profile",
	}

	authorizeURL, err := tm.StartAuth("testuser", "meshtest", settings, "https://grafana.example.com/callback")
	require.NoError(t, err)

	assert.Contains(t, authorizeURL, "https://connect.example.com/connect/authorize")
	assert.Contains(t, authorizeURL, "client_id=grafana-datasource")
	assert.Contains(t, authorizeURL, "response_type=code")
	assert.Contains(t, authorizeURL, "code_challenge_method=S256")
	assert.Contains(t, authorizeURL, "acr_values=tenant%3Ameshtest")
	assert.Contains(t, authorizeURL, "scope=openid+profile")
	assert.Contains(t, authorizeURL, "state=")
	assert.Contains(t, authorizeURL, "code_challenge=")
}

func TestStartAuthMissingConfig(t *testing.T) {
	tm := newTestTokenManager()

	t.Run("missing identity server URL", func(t *testing.T) {
		settings := &Settings{OAuthClientID: "test"}
		_, err := tm.StartAuth("user", "tenant", settings, "https://callback")
		assert.ErrorContains(t, err, "identity server URL")
	})

	t.Run("missing client ID", func(t *testing.T) {
		settings := &Settings{IdentityServerURL: "https://connect.example.com"}
		_, err := tm.StartAuth("user", "tenant", settings, "https://callback")
		assert.ErrorContains(t, err, "OAuth client ID")
	})
}

func TestHandleCallback(t *testing.T) {
	// Start a mock token endpoint
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))

		err := r.ParseForm()
		require.NoError(t, err)
		assert.Equal(t, "authorization_code", r.Form.Get("grant_type"))
		assert.Equal(t, "grafana-datasource", r.Form.Get("client_id"))
		assert.NotEmpty(t, r.Form.Get("code_verifier"))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "test-access-token",
			"refresh_token": "test-refresh-token",
			"token_type":    "Bearer",
			"expires_in":    3600,
		})
	}))
	defer server.Close()

	tm := newTestTokenManager()
	settings := &Settings{
		TenantID:          "meshtest",
		IdentityServerURL: server.URL,
		OAuthClientID:     "grafana-datasource",
		OAuthScopes:       "openid",
	}

	// First start an auth flow to get a valid state
	authorizeURL, err := tm.StartAuth("testuser", "meshtest", settings, "https://grafana.example.com/callback")
	require.NoError(t, err)

	// Extract state from authorize URL
	parsed, err := http.NewRequest("GET", authorizeURL, nil)
	require.NoError(t, err)
	state := parsed.URL.Query().Get("state")
	require.NotEmpty(t, state)

	// Handle callback
	entry, err := tm.HandleCallback(state, "test-auth-code", settings)
	require.NoError(t, err)
	assert.Equal(t, "test-access-token", entry.AccessToken)
	assert.Equal(t, "test-refresh-token", entry.RefreshToken)
	assert.Equal(t, "meshtest", entry.TenantID)

	// Token should now be cached
	cached, err := tm.GetToken("testuser", "meshtest", settings)
	require.NoError(t, err)
	require.NotNil(t, cached)
	assert.Equal(t, "test-access-token", cached.AccessToken)
}

func TestHandleCallbackUnknownState(t *testing.T) {
	tm := newTestTokenManager()
	settings := &Settings{
		IdentityServerURL: "https://connect.example.com",
		OAuthClientID:     "test",
	}

	_, err := tm.HandleCallback("unknown-state", "code", settings)
	assert.ErrorContains(t, err, "unknown or expired state")
}

func TestGetTokenRefresh(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		err := r.ParseForm()
		require.NoError(t, err)
		assert.Equal(t, "refresh_token", r.Form.Get("grant_type"))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token": "refreshed-token",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer server.Close()

	tm := newTestTokenManager()
	settings := &Settings{
		TenantID:          "meshtest",
		IdentityServerURL: server.URL,
		OAuthClientID:     "grafana-datasource",
	}

	// Store an expired token with a refresh token
	key := tokenKey("testuser", "meshtest")
	tm.tokens.Store(key, &TokenEntry{
		AccessToken:  "expired-token",
		RefreshToken: "test-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Minute),
		TenantID:     "meshtest",
	})

	// GetToken should trigger refresh
	entry, err := tm.GetToken("testuser", "meshtest", settings)
	require.NoError(t, err)
	require.NotNil(t, entry)
	assert.Equal(t, "refreshed-token", entry.AccessToken)
	assert.Equal(t, "test-refresh-token", entry.RefreshToken) // Preserved from original
	assert.Equal(t, 1, callCount)
}

func TestHasToken(t *testing.T) {
	tm := newTestTokenManager()

	assert.False(t, tm.HasToken("user", "tenant"))

	key := tokenKey("user", "tenant")
	tm.tokens.Store(key, &TokenEntry{
		AccessToken: "token",
		ExpiresAt:   time.Now().Add(5 * time.Minute),
	})

	assert.True(t, tm.HasToken("user", "tenant"))
}
