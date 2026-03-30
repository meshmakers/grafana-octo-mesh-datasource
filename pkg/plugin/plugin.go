package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

var _ backend.QueryDataHandler = (*Datasource)(nil)
var _ backend.CheckHealthHandler = (*Datasource)(nil)
var _ backend.CallResourceHandler = (*Datasource)(nil)

type Datasource struct {
	resourceHandler backend.CallResourceHandler
	settings        *Settings
	tokenManager    *TokenManager
	httpClient      *http.Client
	logger          log.Logger
}

type Settings struct {
	TenantID          string `json:"tenantId"`
	IdentityServerURL string `json:"identityServerUrl"`
	OAuthClientID     string `json:"oauthClientId"`
	OAuthScopes       string `json:"oauthScopes"`
	TLSSkipVerify     bool   `json:"tlsSkipVerify"`
	// Grafana admin credentials for org management (Server Admin API requires Basic Auth)
	GrafanaAdminUser     string `json:"-"` // From secureJsonData
	GrafanaAdminPassword string `json:"-"` // From secureJsonData
	URL                  string `json:"-"`
}

func parseSettings(s backend.DataSourceInstanceSettings) (*Settings, error) {
	settings := &Settings{}
	if err := json.Unmarshal(s.JSONData, settings); err != nil {
		return nil, fmt.Errorf("failed to parse settings: %w", err)
	}
	settings.URL = s.URL
	// Read Grafana admin credentials from encrypted secure JSON data
	if user, ok := s.DecryptedSecureJSONData["grafanaAdminUser"]; ok {
		settings.GrafanaAdminUser = user
	}
	if pass, ok := s.DecryptedSecureJSONData["grafanaAdminPassword"]; ok {
		settings.GrafanaAdminPassword = pass
	}
	return settings, nil
}

func NewDatasource(_ context.Context, s backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	settings, err := parseSettings(s)
	if err != nil {
		return nil, err
	}

	logger := log.DefaultLogger.With("datasource", s.Name)
	tokenManager := NewTokenManager(logger)

	ds := &Datasource{
		settings:     settings,
		tokenManager: tokenManager,
		httpClient:   newProxyClient(settings.TLSSkipVerify),
		logger:       logger,
	}

	mux := http.NewServeMux()
	// Auth endpoints
	mux.HandleFunc("GET /auth/status", ds.handleAuthStatus)
	mux.HandleFunc("GET /auth/start", ds.handleAuthStart)
	mux.HandleFunc("GET /auth/callback", ds.handleAuthCallback)
	// Proxy endpoints — route API calls through backend with tenant token
	mux.HandleFunc("GET /tenants", ds.handleProxyTenants)
	mux.HandleFunc("POST /graphql", ds.handleProxyGraphQL)
	mux.HandleFunc("/system/", ds.handleProxySystemAPI)
	// Admin endpoints — provision/deprovision Grafana org + datasource for a tenant
	mux.HandleFunc("POST /admin/provision-tenant", ds.handleProvisionTenant)
	mux.HandleFunc("POST /admin/deprovision-tenant", ds.handleDeprovisionTenant)

	ds.resourceHandler = httpadapter.New(mux)

	return ds, nil
}

func (d *Datasource) Dispose() {
	d.tokenManager.Stop()
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()

	// Get user login for token lookup
	userLogin := ""
	if req.PluginContext.User != nil {
		userLogin = req.PluginContext.User.Login
	}

	// Ensure the user is a member of the tenant org (lazy assignment on first query)
	if userLogin != "" && d.hasGrafanaAdminCredentials() {
		d.addUserToTenantOrg("http://localhost:3000", userLogin)
	}

	for _, q := range req.Queries {
		res := d.handleQuery(ctx, q, userLogin)
		response.Responses[q.RefID] = res
	}

	return response, nil
}

// handleQuery processes a single query by forwarding the GraphQL request to OctoMesh.
// The frontend sends the fully constructed GraphQL payload; the backend adds auth and proxies.
func (d *Datasource) handleQuery(ctx context.Context, q backend.DataQuery, userLogin string) backend.DataResponse {
	if userLogin == "" {
		return backend.DataResponse{
			Error:  fmt.Errorf("no user context available"),
			Status: backend.StatusUnauthorized,
		}
	}

	token, err := d.tokenManager.GetToken(userLogin, d.settings.TenantID, d.settings)
	if err != nil {
		d.logger.Error("Failed to get token for query", "error", err)
	}
	if token == nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("not authenticated for tenant %s — please authenticate first", d.settings.TenantID),
			Status: backend.StatusUnauthorized,
		}
	}

	// Parse the query JSON to extract the GraphQL payload
	var payload graphqlRequestPayload
	if err := json.Unmarshal(q.JSON, &payload); err != nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("failed to parse query payload: %w", err),
			Status: backend.StatusBadRequest,
		}
	}

	if payload.Query == "" {
		return backend.DataResponse{
			Error:  fmt.Errorf("query payload missing GraphQL query string"),
			Status: backend.StatusBadRequest,
		}
	}

	// Forward GraphQL request to OctoMesh
	targetURL := fmt.Sprintf("%s/tenants/%s/graphql",
		strings.TrimRight(d.settings.URL, "/"), d.settings.TenantID)

	body, err := json.Marshal(payload)
	if err != nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("failed to marshal GraphQL payload: %w", err),
			Status: backend.StatusInternal,
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, strings.NewReader(string(body)))
	if err != nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("failed to create request: %w", err),
			Status: backend.StatusInternal,
		}
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token.AccessToken))

	resp, err := d.httpClient.Do(httpReq)
	if err != nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("GraphQL request failed: %w", err),
			Status: backend.StatusInternal,
		}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return backend.DataResponse{
			Error:  fmt.Errorf("failed to read response: %w", err),
			Status: backend.StatusInternal,
		}
	}

	if resp.StatusCode != http.StatusOK {
		return backend.DataResponse{
			Error:  fmt.Errorf("OctoMesh returned HTTP %d: %s", resp.StatusCode, string(respBody)),
			Status: backend.StatusInternal,
		}
	}

	// Return the raw GraphQL response as a JSON data frame
	// The frontend will parse and transform it into Grafana DataFrames
	frame := data.NewFrame("response",
		data.NewField("data", nil, []string{string(respBody)}),
	)

	return backend.DataResponse{
		Frames: data.Frames{frame},
	}
}

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if d.settings.URL == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "OctoMesh URL is not configured",
		}, nil
	}

	if d.settings.TenantID == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "Tenant ID is not configured",
		}, nil
	}

	if d.settings.IdentityServerURL == "" || d.settings.OAuthClientID == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: "OAuth configuration incomplete: Identity Server URL and Client ID are required",
		}, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: fmt.Sprintf("Backend plugin loaded. Tenant: %s", d.settings.TenantID),
	}, nil
}

func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	return d.resourceHandler.CallResource(ctx, req, sender)
}

// getUserLogin extracts the user login from the HTTP request's plugin context.
func getUserLogin(r *http.Request) string {
	pluginCtx := httpadapter.PluginConfigFromContext(r.Context())
	if pluginCtx.User != nil {
		return pluginCtx.User.Login
	}
	return ""
}

func (d *Datasource) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	userLogin := getUserLogin(r)
	if userLogin == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"authenticated": false,
			"error":         "No user context available",
		})
		return
	}

	hasToken := d.tokenManager.HasToken(userLogin, d.settings.TenantID)

	// Check if Grafana org exists for this tenant, and ensure user is a member
	// Also add user to ALL provisioned tenant orgs (handles users created after provisioning)
	orgProvisioned := true
	if d.hasGrafanaAdminCredentials() {
		orgProvisioned = d.checkTenantOrgExists("http://localhost:3000")
		d.addUserToAllTenantOrgs("http://localhost:3000", userLogin)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated":  hasToken,
		"tenantId":       d.settings.TenantID,
		"userLogin":      userLogin,
		"orgProvisioned": orgProvisioned,
	})
}

func (d *Datasource) handleAuthStart(w http.ResponseWriter, r *http.Request) {
	userLogin := getUserLogin(r)
	if userLogin == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error": "No user context available",
		})
		return
	}

	// Build the callback URL from the request's Origin/Referer
	callbackURL := buildCallbackURL(r)
	if callbackURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Cannot determine callback URL. Provide 'callbackUrl' query parameter.",
		})
		return
	}

	authorizeURL, err := d.tokenManager.StartAuth(userLogin, d.settings.TenantID, d.settings, callbackURL)
	if err != nil {
		d.logger.Error("Failed to start auth", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"authorizeUrl": authorizeURL,
	})
}

func (d *Datasource) handleAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		// Check for error response from Identity Server
		errParam := r.URL.Query().Get("error")
		errDesc := r.URL.Query().Get("error_description")
		if errParam != "" {
			writeCallbackHTML(w, false, fmt.Sprintf("Authentication denied: %s - %s", errParam, errDesc))
			return
		}
		writeCallbackHTML(w, false, "Missing code or state parameter")
		return
	}

	entry, err := d.tokenManager.HandleCallback(state, code, d.settings)
	if err != nil {
		d.logger.Error("Auth callback failed", "error", err)
		writeCallbackHTML(w, false, fmt.Sprintf("Authentication failed: %s", err.Error()))
		return
	}

	// Add user to the tenant's Grafana org (if provisioned)
	if entry.UserLogin != "" {
		d.addUserToTenantOrg("http://localhost:3000", entry.UserLogin)
	}

	writeCallbackHTML(w, true, "Authentication successful")
}

// buildCallbackURL constructs the OAuth callback URL.
// The frontend should pass it as a query parameter.
func buildCallbackURL(r *http.Request) string {
	// Prefer explicit callbackUrl query parameter
	if cb := r.URL.Query().Get("callbackUrl"); cb != "" {
		return cb
	}
	return ""
}

// writeJSON writes a JSON response.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeCallbackHTML writes an HTML page that communicates the result to the opener window and closes the popup.
func writeCallbackHTML(w http.ResponseWriter, success bool, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	successStr := "false"
	if success {
		successStr = "true"
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><title>OctoMesh Authentication</title></head>
<body>
<p>%s</p>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'octo-mesh-auth-callback',
      success: %s,
      message: %q
    }, window.location.origin);
    setTimeout(function() { window.close(); }, 1000);
  } else {
    document.body.innerHTML += '<p>You may close this window.</p>';
  }
</script>
</body>
</html>`, message, successStr, message)

	fmt.Fprint(w, html)
}
