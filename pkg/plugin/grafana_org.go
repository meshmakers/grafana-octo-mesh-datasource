package plugin

import (
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

// ensureGrafanaOrg checks if a Grafana org exists for the configured tenantId,
// creates it if missing, and ensures the user is a member.
// This is a best-effort operation — errors are logged but don't block authentication.
func (d *Datasource) ensureGrafanaOrg(grafanaBaseURL, userLogin string) {
	if d.settings.GrafanaServiceAccountToken == "" || d.settings.TenantID == "" {
		return
	}

	orgName := d.settings.TenantID

	// Check if org already exists
	org, err := d.getOrgByName(grafanaBaseURL, orgName)
	if err != nil {
		d.logger.Warn("Failed to check Grafana org", "org", orgName, "error", err)
		return
	}

	var orgID int64
	if org != nil {
		orgID = org.ID
	} else {
		// Create the org
		orgID, err = d.createOrg(grafanaBaseURL, orgName)
		if err != nil {
			d.logger.Warn("Failed to create Grafana org", "org", orgName, "error", err)
			return
		}
		d.logger.Info("Created Grafana org", "org", orgName, "orgId", orgID)
	}

	// Ensure the user is a member of the org
	if err := d.addUserToOrg(grafanaBaseURL, orgID, userLogin, "Editor"); err != nil {
		// May fail if user is already a member — that's fine
		d.logger.Debug("Add user to org result", "org", orgName, "user", userLogin, "error", err)
	}
}

// getOrgByName fetches a Grafana org by name. Returns nil if not found (404).
func (d *Datasource) getOrgByName(grafanaBaseURL, orgName string) (*grafanaOrg, error) {
	url := fmt.Sprintf("%s/api/orgs/name/%s", strings.TrimRight(grafanaBaseURL, "/"), orgName)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.settings.GrafanaServiceAccountToken)

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
		return nil, fmt.Errorf("GET org by name returned %d: %s", resp.StatusCode, string(body))
	}

	var org grafanaOrg
	if err := json.NewDecoder(resp.Body).Decode(&org); err != nil {
		return nil, err
	}
	return &org, nil
}

// createOrg creates a new Grafana organization and returns its ID.
func (d *Datasource) createOrg(grafanaBaseURL, orgName string) (int64, error) {
	url := fmt.Sprintf("%s/api/orgs", strings.TrimRight(grafanaBaseURL, "/"))

	payload, _ := json.Marshal(map[string]string{"name": orgName})
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.settings.GrafanaServiceAccountToken)

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

// addUserToOrg adds a user to a Grafana organization with the specified role.
func (d *Datasource) addUserToOrg(grafanaBaseURL string, orgID int64, loginOrEmail, role string) error {
	url := fmt.Sprintf("%s/api/orgs/%d/users", strings.TrimRight(grafanaBaseURL, "/"), orgID)

	payload, _ := json.Marshal(map[string]string{
		"loginOrEmail": loginOrEmail,
		"role":         role,
	})
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.settings.GrafanaServiceAccountToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return nil
	}

	body, _ := io.ReadAll(resp.Body)
	// 409 Conflict = user already in org — not an error
	if resp.StatusCode == http.StatusConflict {
		return nil
	}
	return fmt.Errorf("POST org user returned %d: %s", resp.StatusCode, string(body))
}
