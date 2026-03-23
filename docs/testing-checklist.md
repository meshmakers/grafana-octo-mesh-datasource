# Testing Checklist: Tenant-Specific OAuth

## Automated Tests

### Go Backend
```bash
go test -v ./pkg/plugin/ -count=1
```

Covers:
- [x] PKCE code verifier/challenge generation
- [x] Authorize URL construction with `acr_values=tenant:{tenantId}`
- [x] Token cache get/set/expiry (30s buffer)
- [x] Token exchange (mock token endpoint)
- [x] Refresh token flow
- [x] Missing configuration error handling
- [x] Unknown state parameter rejection

### TypeScript Frontend
```bash
npm run test:ci
```

Covers:
- [x] Query execution with time filters
- [x] Filter conversion (all operator types)
- [x] QueryEditor renders with auth status mock
- [x] DateTime column type detection (case-insensitive)

## Manual Testing

### Basic Configuration
- [ ] Configure datasource with OctoMesh URL, Tenant ID, Identity Server URL, Client ID
- [ ] "Save & Test" shows appropriate status message
- [ ] Skip TLS Verify toggle works for dev environments

### Authentication Flow
- [ ] Open QueryEditor — "Authentication required" banner appears
- [ ] Click "Authenticate" — popup opens to Identity Server
- [ ] Identity Server shows correct tenant login page (not System-Tenant)
- [ ] After login, popup closes automatically
- [ ] Banner disappears, QueryEditor loads SystemQueries
- [ ] Subsequent page refreshes — no re-authentication needed (token cached)

### Query Execution
- [ ] Select a SystemQuery — columns preview loads
- [ ] Run query — data appears in panel
- [ ] Time filter column works with Grafana time range
- [ ] Field filters work (equals, contains, between, etc.)
- [ ] Max rows setting respected

### Token Management
- [ ] Wait for token expiry (3600s) — refresh happens silently
- [ ] Restart Grafana pod — user re-authenticates (SSO, no password prompt if IdP cookie valid)
- [ ] Inspect Go backend logs: "Token acquired", no errors

### Multi-Tenant (if applicable)
- [ ] Configure two Grafana Orgs with different tenants
- [ ] Switch from Org 1 to Org 2 — auth prompt for new tenant
- [ ] Authenticate for Org 2
- [ ] Switch back to Org 1 — SSO, no login prompt
- [ ] Each org queries the correct tenant data

### Error Handling
- [ ] Remove Identity Server URL — "Save & Test" shows config error
- [ ] Wrong Client ID — authentication fails with clear error in popup
- [ ] Network error to Identity Server — appropriate error message
- [ ] Expired/invalid token — re-authentication triggered
- [ ] Popup blocked by browser — error message shown

### CI/CD Pipeline
- [ ] Docker build succeeds (Go + Node stages)
- [ ] Output contains `gpx_grafana-octo-mesh-datasource_linux_amd64`
- [ ] Output contains `module.js` and `plugin.json` with `backend: true`
- [ ] Azure Pipeline builds and publishes artifact
