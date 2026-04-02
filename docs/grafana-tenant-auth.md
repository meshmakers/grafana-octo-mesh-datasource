# Grafana OctoMesh Datasource: Tenant-Specific Authentication

## Problem Statement

The Grafana OctoMesh Datasource needs to query tenant-specific APIs. OctoMesh's `TenantAuthorizationMiddleware` enforces that the token's `tenant_id` claim matches the API route's tenant -- requests with a mismatched `tenant_id` receive **403 Forbidden**.

Users exist only in their respective tenant (e.g., `meshtest`, `sbeg`), not in the System-Tenant. Each Grafana Organization maps to one OctoMesh Tenant and has a datasource configured with that tenant's ID.

## Solution: Tenant-Specific OAuth via `acr_values`

The OctoMesh Identity Server supports the `acr_values=tenant:{tenantId}` parameter on `/connect/authorize`. This directs the user to the correct tenant's login page, authenticates them there, and issues a token with the correct `tenant_id`, roles, and scopes.

**No Identity Server changes are required.** The existing `acr_values` mechanism solves the problem. The work is on the Grafana plugin side.

### Authentication Flow

```
Grafana Org "meshtest"     Identity Server              Tenant "meshtest"
  |                             |                            |
  | Datasource config:          |                            |
  | tenantId = meshtest         |                            |
  |                             |                            |
  |-- /connect/authorize ------>|                            |
  |   acr_values=tenant:meshtest|                            |
  |                             |-- Redirect to meshtest --->|
  |                             |   login page               |
  |                             |                            |
  |                             |<-- User authenticated -----|
  |                             |                            |
  |<-- Token -------------------|                            |
  |   tenant_id = meshtest      |                            |
  |   roles from meshtest       |                            |
  |                             |                            |
  |-- API call with token ----->|                            |
  |   /tenants/meshtest/GraphQL |                            |
  |   (tenant_id matches!)      |                            |
```

### Issued Token

The issued access token contains:

- `tenant_id`: Matches the tenant from `acr_values` (e.g., `meshtest`)
- `role`: Roles assigned to the user in that tenant
- `allowed_tenants`: All tenants the user may access
- `sub`: The user's identity within the tenant

The token passes `TenantAuthorizationMiddleware` because `tenant_id` matches the API route.

## Plugin Changes Required

### 1. Datasource Configuration

Add a `tenantId` field to the datasource configuration UI. Each datasource instance stores the target OctoMesh tenant ID.

### 2. OAuth Authorize Request

The plugin must include `acr_values=tenant:{tenantId}` in the OAuth authorize URL, where `{tenantId}` comes from the datasource configuration. This requires a Go backend component that controls the OAuth flow.

### 3. Go Backend Component

The datasource plugin needs a Go backend to handle tenant-specific OAuth:

- Read `tenantId` from the datasource configuration
- Append `acr_values=tenant:{tenantId}` to the authorize URL
- Handle the authorization code exchange
- Cache and refresh tokens per tenant

## Organization Switching and SSO Behavior

When a user switches between Grafana Organizations (each mapped to a different OctoMesh tenant), the plugin backend must obtain a token for the new tenant. The user experience depends on whether the user has previously authenticated with that tenant.

### Per-Tenant Cookie Scoping

The Identity Server stores a separate authentication cookie per tenant via `TenantCookieManager`:

```
.AspNetCore.Identity.Application.meshtest   ← session for meshtest
.AspNetCore.Identity.Application.sbeg       ← session for sbeg
```

These cookies are independent -- authenticating in one tenant does not affect sessions in other tenants.

### User Experience When Switching Organizations

| Scenario | What Happens |
|----------|-------------|
| First visit to tenant `meshtest` | Full login (username/password, LDAP, external IdP -- whatever the tenant has configured) |
| Switch to tenant `sbeg` (first time) | Full login for `sbeg` |
| Switch back to `meshtest` | SSO -- cookie exists, token issued silently (no login screen) |
| Switch back to `sbeg` | SSO -- cookie exists, token issued silently |
| Cookie expired for `meshtest` | Full login again |

After the initial login per tenant, subsequent organization switches are seamless via SSO.

### Plugin Token Management

This approach replaces Grafana's standard `oauthPassThru` mechanism (which forwards a single global OAuth token). The Go backend must manage tokens independently:

- **Per-user, per-tenant token cache**: Store access tokens keyed by `(grafana_user_id, tenant_id)`
- **On datasource request**: Check if a valid (non-expired) token exists for the user and tenant
  - **Token exists**: Use it for the API call
  - **No token / expired**: Initiate an OAuth authorize flow with `acr_values=tenant:{tenantId}` and redirect the user
- **Refresh tokens**: When `offline_access` scope is included and the token expires, use the refresh token to obtain a new access token without user interaction
- **Token lifetime**: Access tokens are valid for 3600 seconds (default). With refresh tokens, the user only re-authenticates when the refresh token expires or the Identity Server session cookie expires.

## Why the Go Backend Is Required

The `TenantAuthorizationMiddleware` in `octo-common-services` validates that the token's `tenant_id` claim **exactly matches** the API route's tenant. It does **not** check `allowed_tenants`. This means a single OAuth token cannot be used across multiple tenants -- each tenant requires its own token.

Grafana's built-in `oauthPassThru` forwards a single global token, which only has one `tenant_id`. When a user switches Grafana organizations (each mapped to a different tenant), the forwarded token's `tenant_id` would mismatch, resulting in 403. The Go backend solves this by managing per-user, per-tenant tokens independently.

## Grafana Login (Tenant Discovery)

For the initial Grafana login, the Identity Server provides a **tenant discovery flow**. When Grafana's OAuth sends `/connect/authorize` without `acr_values`, the Identity Server redirects to a tenant picker page where the user enters their email to discover their tenant. After selection, the login proceeds with `acr_values=tenant:{selectedTenant}`.

The Grafana login token includes `allowed_tenants` as an array claim (via the `allowed_tenants` IdentityResource). Grafana uses this for `org_attribute_path` to auto-assign users to the correct organizations:

```ini
[auth.generic_oauth]
org_attribute_path = allowed_tenants
org_mapping = meshtest:Meshtest:Viewer sbeg:SBEG:Editor
scopes = openid profile email role allowed_tenants
```

## Evaluated and Rejected Alternatives

| Approach | Why Rejected |
|----------|-------------|
| **RFC 8693 Token Exchange** | Unnecessary complexity. Users don't exist in the System-Tenant, so there's no source token to exchange. The `acr_values` approach is simpler and direct. |
| **Separate Grafana instances** | Operational overhead (N instances to maintain). One instance with multiple organizations is preferred. |
| **Client Credentials per Datasource** | Loses user identity. Audit trails show only the service account, not the actual user. |
| **Middleware Relaxation** | Security risk. `TenantAuthorizationMiddleware` checks `tenant_id` not `allowed_tenants` by design -- the token must be scoped to the specific tenant. |
| **Grafana oauthPassThru only** | Fails because the Grafana login token has a single `tenant_id`. Org switching would cause 403 for non-login tenants. |

## Tenant Organization Provisioning

Grafana organizations are created per tenant via the plugin's admin endpoints or pipeline nodes. The provisioning flow:

1. **Pipeline or API** calls `POST /admin/provision-tenant` with `{ "grafanaBaseUrl": "...", "tenantId": "sbeg" }`
2. Plugin creates Grafana org named `sbeg` with a datasource (UID: `octomesh-sbeg`)
3. All existing OAuth users are added to the new org as Editor
4. New users are assigned on their first dashboard load (Welcome Dashboard ping query)

### Identity Server Client Registration

The `grafana-datasource` OAuth client must be registered in each tenant with the correct redirect URI:

```
http(s)://{grafana-host}/api/datasources/uid/octomesh-{tenantId}/resources/auth/callback
```

The datasource UID is deterministic (`octomesh-{tenantId}`), so the redirect URI can be registered before provisioning.

## Known Limitations

### 1. Page Reload Required After First Login

When a user logs in for the first time, they land in the Main Organization (Org 1). The Welcome Dashboard triggers a background query that assigns them to all provisioned tenant organizations. However, **Grafana caches the organization list on page load**, so the org switcher only shows the new organizations after a browser reload (F5).

**Root cause**: Grafana has no hook for plugins during the OAuth login flow. The plugin can only act when a datasource query is executed, which happens after the page has already rendered.

**Possible solutions for future improvement**:
- Build a Grafana **App Plugin** that runs on every page load and calls the user-to-org assignment API
- Contribute a Grafana feature for dynamic `org_mapping` that maps OAuth claim values to org names automatically
- Use a frontend redirect after the Welcome Dashboard detects new org membership

### 2. Warning Icon on Welcome Dashboard

The stat panel that triggers the ping query shows a small warning icon because the `__ping__` query returns no data. This is cosmetic and does not affect functionality.

**Possible solutions**:
- Build a custom Grafana panel plugin that executes the ping silently without rendering anything
- Use Grafana's `annotations` or `dashboard variable` queries instead (if they trigger backend calls)

### 3. Two-Step Authentication

Users must authenticate twice:
1. **Grafana Login** (via Identity Server OAuth) — for Grafana session
2. **Datasource Authentication** (via plugin popup) — for tenant-specific API token

This is by design: `TenantAuthorizationMiddleware` requires `tenant_id` to match exactly, so the Grafana login token (which has one `tenant_id`) cannot be used for all tenants.

### 4. Identity Server URL Split (Browser vs Backend)

The `identityServerUrl` is used for both browser-facing requests (authorize URL) and backend requests (token exchange). In Docker environments, the browser needs `localhost` but the plugin backend needs `host.docker.internal`. Currently solved with an `internalURL()` rewrite in the Go plugin. In production (Kubernetes), both resolve to the same hostname so this is not an issue.

### 5. No Dynamic org_mapping in Grafana

Grafana's `org_mapping` requires static configuration — there is no "map claim value to org with same name" wildcard. Organization membership is managed entirely by the plugin instead.

## Identity Server Reference

The Identity Server's tenant-specific OAuth capability is documented in the identity server repository:

- `docs/CONCEPT-TENANT-SPECIFIC-OAUTH.md` -- Full documentation of the `acr_values` mechanism, tenant discovery flow, and `allowed_tenants` IdentityResource
- `docs/authentication.md` -- Tenant resolution and token endpoint architecture

Key Identity Server components involved:

| Component | Role |
|-----------|------|
| `OidcTenantResolutionMiddleware` | Parses `acr_values=tenant:{tenantId}` from authorize requests; redirects to tenant discovery when missing |
| `TenantLoginRedirectMiddleware` | Redirects to the tenant-specific login page |
| `TenantDiscoveryService` | Searches all tenants for a user by email/username (for tenant picker) |
| `UserProfileService` | Adds `tenant_id` and `allowed_tenants` claims to tokens |
| `TenantCookieManager` | Per-tenant cookie scoping for concurrent multi-tenant sessions |
