package plugin

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// grafanaOrg represents a Grafana organization from the API.
type grafanaOrg struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// provisionRequest is the JSON body for the provision/deprovision-tenant endpoints.
type provisionRequest struct {
	GrafanaBaseURL string `json:"grafanaBaseUrl"`
	TenantID       string `json:"tenantId"`
}

// grafanaBasicAuth returns the Basic Auth header value for Grafana admin API calls.
func (d *Datasource) grafanaBasicAuth() string {
	return "Basic " + base64.StdEncoding.EncodeToString(
		[]byte(d.settings.GrafanaAdminUser+":"+d.settings.GrafanaAdminPassword))
}

// hasGrafanaAdminCredentials returns true if Grafana admin credentials are configured.
func (d *Datasource) hasGrafanaAdminCredentials() bool {
	return d.settings.GrafanaAdminUser != "" && d.settings.GrafanaAdminPassword != ""
}

// handleProvisionTenant creates a Grafana org for a tenant and
// creates a datasource instance in that org.
func (d *Datasource) handleProvisionTenant(w http.ResponseWriter, r *http.Request) {
	if !d.hasGrafanaAdminCredentials() {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Grafana admin credentials are not configured in the datasource settings",
		})
		return
	}

	var req provisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GrafanaBaseURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Request body must contain 'grafanaBaseUrl'",
		})
		return
	}

	grafanaBaseURL := strings.TrimRight(req.GrafanaBaseURL, "/")
	orgName := req.TenantID
	if orgName == "" {
		orgName = d.settings.TenantID
	}
	if orgName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "tenantId is required (in request body or datasource config)",
		})
		return
	}

	// Check if org already exists
	org, err := d.getOrgByName(grafanaBaseURL, orgName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": fmt.Sprintf("Failed to check org: %s", err),
		})
		return
	}

	var orgID int64
	if org != nil {
		orgID = org.ID
		d.logger.Info("Grafana org already exists", "org", orgName, "orgId", orgID)
	} else {
		orgID, err = d.createOrg(grafanaBaseURL, orgName)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
				"error": fmt.Sprintf("Failed to create org: %s", err),
			})
			return
		}
		d.logger.Info("Created Grafana org", "org", orgName, "orgId", orgID)
	}

	// Create a datasource in the new org
	dsErr := d.createDatasourceInOrg(grafanaBaseURL, orgID, orgName)
	if dsErr != nil {
		d.logger.Warn("Failed to create datasource in org (may already exist)", "org", orgName, "error", dsErr)
	}

	// Add all existing OAuth users to the new org so they can switch to it
	usersAdded := d.addAllOAuthUsersToOrg(grafanaBaseURL, orgID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":    fmt.Sprintf("Tenant '%s' provisioned in Grafana org %d", orgName, orgID),
		"orgId":      orgID,
		"orgName":    orgName,
		"usersAdded": usersAdded,
	})
}

// handleDeprovisionTenant removes the Grafana org for a tenant.
func (d *Datasource) handleDeprovisionTenant(w http.ResponseWriter, r *http.Request) {
	if !d.hasGrafanaAdminCredentials() {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Grafana admin credentials are not configured in the datasource settings",
		})
		return
	}

	var req provisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GrafanaBaseURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Request body must contain 'grafanaBaseUrl'",
		})
		return
	}

	grafanaBaseURL := strings.TrimRight(req.GrafanaBaseURL, "/")
	orgName := req.TenantID
	if orgName == "" {
		orgName = d.settings.TenantID
	}
	if orgName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "tenantId is required (in request body or datasource config)",
		})
		return
	}

	org, err := d.getOrgByName(grafanaBaseURL, orgName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": fmt.Sprintf("Failed to check org: %s", err),
		})
		return
	}
	if org == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": fmt.Sprintf("Grafana org '%s' does not exist", orgName),
		})
		return
	}

	if err := d.deleteOrg(grafanaBaseURL, org.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": fmt.Sprintf("Failed to delete org: %s", err),
		})
		return
	}

	d.logger.Info("Deleted Grafana org", "org", orgName, "orgId", org.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("Tenant '%s' deprovisioned (org %d deleted)", orgName, org.ID),
	})
}

// CheckTenantOrgExists checks if a Grafana org exists for the datasource's tenant.
// Called during auth status checks to show a message when the org is not provisioned.
func (d *Datasource) checkTenantOrgExists(grafanaBaseURL string) bool {
	if !d.hasGrafanaAdminCredentials() {
		return true // Can't check without credentials, assume OK
	}
	org, err := d.getOrgByName(grafanaBaseURL, d.settings.TenantID)
	if err != nil {
		return true // Can't check, assume OK
	}
	return org != nil
}

// addUserToTenantOrg checks if a Grafana org exists for the tenant and adds the user to it.
// Called after successful OAuth authentication. If the org doesn't exist (not provisioned),
// this is a no-op — the user stays in their current org.
func (d *Datasource) addUserToTenantOrg(grafanaBaseURL, userLogin string) {
	if !d.hasGrafanaAdminCredentials() || d.settings.TenantID == "" {
		return
	}

	org, err := d.getOrgByName(grafanaBaseURL, d.settings.TenantID)
	if err != nil {
		d.logger.Debug("Failed to check tenant org on login", "tenant", d.settings.TenantID, "error", err)
		return
	}
	if org == nil {
		d.logger.Debug("Tenant org not provisioned, skipping user assignment", "tenant", d.settings.TenantID)
		return
	}

	if err := d.addUserToOrg(grafanaBaseURL, org.ID, userLogin, "Editor"); err != nil {
		d.logger.Debug("Add user to tenant org result", "tenant", d.settings.TenantID, "user", userLogin, "error", err)
	} else {
		d.logger.Info("Added user to tenant org", "tenant", d.settings.TenantID, "user", userLogin, "orgId", org.ID)
	}
}

// addUserToAllTenantOrgs adds the user to all provisioned tenant orgs (all orgs except "Main Org.").
// Called on every auth status check so new users get access to existing tenant orgs.
func (d *Datasource) addUserToAllTenantOrgs(grafanaBaseURL, userLogin string) {
	if !d.hasGrafanaAdminCredentials() || userLogin == "" {
		return
	}

	url := fmt.Sprintf("%s/api/orgs", grafanaBaseURL)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var orgs []grafanaOrg
	if err := json.NewDecoder(resp.Body).Decode(&orgs); err != nil {
		return
	}

	for _, org := range orgs {
		if org.Name == "Main Org." || org.ID <= 1 {
			continue
		}
		// Best-effort: add user as Viewer, ignore if already member (409)
		_ = d.addUserToOrg(grafanaBaseURL, org.ID, userLogin, "Editor")
	}
}

// addAllOAuthUsersToOrg lists all Grafana users and adds OAuth-authenticated ones to the org.
func (d *Datasource) addAllOAuthUsersToOrg(grafanaBaseURL string, orgID int64) int {
	url := fmt.Sprintf("%s/api/users?perpage=1000", grafanaBaseURL)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		d.logger.Warn("Failed to list users for org assignment", "error", err)
		return 0
	}
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		d.logger.Warn("Failed to list users for org assignment", "error", err)
		return 0
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0
	}

	var users []struct {
		ID         int64    `json:"id"`
		Login      string   `json:"login"`
		AuthLabels []string `json:"authLabels"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&users); err != nil {
		return 0
	}

	added := 0
	for _, u := range users {
		// Only add OAuth users (not the built-in admin)
		isOAuth := false
		for _, label := range u.AuthLabels {
			if label == "Generic OAuth" || label == "OAuth" {
				isOAuth = true
				break
			}
		}
		if !isOAuth {
			continue
		}

		if err := d.addUserToOrg(grafanaBaseURL, orgID, u.Login, "Editor"); err == nil {
			added++
			d.logger.Debug("Added OAuth user to provisioned org", "user", u.Login, "orgId", orgID)
		}
	}

	d.logger.Info("Added OAuth users to provisioned org", "orgId", orgID, "count", added)
	return added
}

// ─── Grafana Admin API helpers ──────────────────────────────────────

// getOrgByName fetches a Grafana org by name. Returns nil if not found (404).
func (d *Datasource) getOrgByName(grafanaBaseURL, orgName string) (*grafanaOrg, error) {
	url := fmt.Sprintf("%s/api/orgs/name/%s", grafanaBaseURL, orgName)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET org returned %d: %s", resp.StatusCode, string(body))
	}

	var org grafanaOrg
	if err := json.NewDecoder(resp.Body).Decode(&org); err != nil {
		return nil, err
	}
	return &org, nil
}

// createOrg creates a new Grafana organization and returns its ID.
func (d *Datasource) createOrg(grafanaBaseURL, orgName string) (int64, error) {
	url := fmt.Sprintf("%s/api/orgs", grafanaBaseURL)

	payload, _ := json.Marshal(map[string]string{"name": orgName})
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("POST org returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		OrgID   int64  `json:"orgId"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, err
	}
	return result.OrgID, nil
}

// deleteOrg deletes a Grafana organization by ID.
func (d *Datasource) deleteOrg(grafanaBaseURL string, orgID int64) error {
	url := fmt.Sprintf("%s/api/orgs/%d", grafanaBaseURL, orgID)

	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("DELETE org returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// addUserToOrg adds a user to a Grafana organization with the specified role.
func (d *Datasource) addUserToOrg(grafanaBaseURL string, orgID int64, loginOrEmail, role string) error {
	url := fmt.Sprintf("%s/api/orgs/%d/users", grafanaBaseURL, orgID)

	payload, _ := json.Marshal(map[string]string{
		"loginOrEmail": loginOrEmail,
		"role":         role,
	})
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", d.grafanaBasicAuth())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 200 OK or 409 Conflict (user already in org) are both fine
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict {
		return nil
	}

	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("POST org user returned %d: %s", resp.StatusCode, string(body))
}

// createDatasourceInOrg creates an OctoMesh datasource in the specified Grafana org.
// Uses the current datasource's settings as template, but with the given tenantId.
func (d *Datasource) createDatasourceInOrg(grafanaBaseURL string, orgID int64, tenantId string) error {
	url := fmt.Sprintf("%s/api/datasources", grafanaBaseURL)

	// Use a deterministic UID based on tenant ID so the OAuth callback URL is predictable
	dsUID := fmt.Sprintf("octomesh-%s", tenantId)

	dsPayload := map[string]interface{}{
		"uid":    dsUID,
		"name":   "OctoMesh",
		"type":   "grafana-octo-mesh-datasource",
		"url":    d.settings.URL,
		"access": "proxy",
		"orgId":  orgID,
		"jsonData": map[string]interface{}{
			"tenantId":          tenantId,
			"identityServerUrl": d.settings.IdentityServerURL,
			"oauthClientId":     d.settings.OAuthClientID,
			"oauthScopes":       d.settings.OAuthScopes,
			"tlsSkipVerify":     d.settings.TLSSkipVerify,
		},
		"secureJsonData": map[string]interface{}{
			"grafanaAdminUser":     d.settings.GrafanaAdminUser,
			"grafanaAdminPassword": d.settings.GrafanaAdminPassword,
		},
	}

	payload, _ := json.Marshal(dsPayload)
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", d.grafanaBasicAuth())
	// Target the specific org
	req.Header.Set("X-Grafana-Org-Id", fmt.Sprintf("%d", orgID))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict {
		return nil // Created or already exists
	}

	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("POST datasource returned %d: %s", resp.StatusCode, string(body))
}
