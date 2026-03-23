package plugin

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// proxyClient creates an HTTP client respecting TLS settings.
func proxyClient(tlsSkipVerify bool) *http.Client {
	client := &http.Client{
		Timeout: 60 * time.Second,
	}
	if tlsSkipVerify {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // User-configured for dev
		}
	}
	return client
}

// handleProxyTenants proxies GET /resources/tenants to the OctoMesh system API.
// This endpoint does not require tenant-specific auth (system-level).
func (d *Datasource) handleProxyTenants(w http.ResponseWriter, r *http.Request) {
	targetURL := fmt.Sprintf("%s/system/v1/tenants", strings.TrimRight(d.settings.URL, "/"))

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// For system endpoints, try to use the user's tenant token if available
	userLogin := getUserLogin(r)
	if userLogin != "" {
		token, _ := d.tokenManager.GetToken(userLogin, d.settings.TenantID, d.settings)
		if token != nil {
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token.AccessToken))
		}
	}

	resp, err := proxyClient(d.settings.TLSSkipVerify).Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": fmt.Sprintf("Failed to reach OctoMesh: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp)
}

// handleProxyGraphQL proxies POST /resources/graphql to the tenant's GraphQL endpoint.
// Injects the tenant-specific OAuth token from the cache.
func (d *Datasource) handleProxyGraphQL(w http.ResponseWriter, r *http.Request) {
	userLogin := getUserLogin(r)
	if userLogin == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error": "No user context available",
		})
		return
	}

	token, err := d.tokenManager.GetToken(userLogin, d.settings.TenantID, d.settings)
	if err != nil {
		d.logger.Error("Failed to get token", "error", err)
	}
	if token == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"error":        "Not authenticated for this tenant",
			"authRequired": true,
			"tenantId":     d.settings.TenantID,
		})
		return
	}

	targetURL := fmt.Sprintf("%s/tenants/%s/graphql", strings.TrimRight(d.settings.URL, "/"), d.settings.TenantID)

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, targetURL, r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token.AccessToken))

	resp, err := proxyClient(d.settings.TLSSkipVerify).Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": fmt.Sprintf("GraphQL request failed: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp)
}

// handleProxySystemAPI proxies requests to /resources/system/* to the OctoMesh system API.
func (d *Datasource) handleProxySystemAPI(w http.ResponseWriter, r *http.Request) {
	// Strip the /system prefix to get the remaining path
	path := strings.TrimPrefix(r.URL.Path, "/system")
	targetURL := fmt.Sprintf("%s/system%s", strings.TrimRight(d.settings.URL, "/"), path)

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	userLogin := getUserLogin(r)
	if userLogin != "" {
		token, _ := d.tokenManager.GetToken(userLogin, d.settings.TenantID, d.settings)
		if token != nil {
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token.AccessToken))
		}
	}

	resp, err := proxyClient(d.settings.TLSSkipVerify).Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": fmt.Sprintf("System API request failed: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp)
}

// proxyResponse copies the upstream response to the downstream writer.
func proxyResponse(w http.ResponseWriter, resp *http.Response) {
	// Copy relevant headers
	for _, h := range []string{"Content-Type", "Content-Length"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// graphqlRequestPayload represents the JSON body of a GraphQL request.
type graphqlRequestPayload struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}
