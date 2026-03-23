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

## Evaluated and Rejected Alternatives

| Approach | Why Rejected |
|----------|-------------|
| **RFC 8693 Token Exchange** | Unnecessary complexity. Users don't exist in the System-Tenant, so there's no source token to exchange. The `acr_values` approach is simpler and direct. |
| **Separate Grafana instances** | Operational overhead (N instances to maintain). One instance with multiple organizations is preferred. |
| **Client Credentials per Datasource** | Loses user identity. Audit trails show only the service account, not the actual user. |
| **Middleware Relaxation** | Security risk. Scopes and roles from the wrong tenant would be used. |

## Identity Server Reference

The Identity Server's tenant-specific OAuth capability is documented in the identity server repository:

- `docs/CONCEPT-TENANT-SPECIFIC-OAUTH.md` -- Full documentation of the `acr_values` mechanism
- `docs/authentication.md` -- Tenant resolution and token endpoint architecture

Key Identity Server components involved:

| Component | Role |
|-----------|------|
| `OidcTenantResolutionMiddleware` | Parses `acr_values=tenant:{tenantId}` from authorize requests |
| `TenantLoginRedirectMiddleware` | Redirects to the tenant-specific login page |
| `UserProfileService` | Adds `tenant_id` and `allowed_tenants` claims to tokens |
| `TenantCookieManager` | Per-tenant cookie scoping for concurrent multi-tenant sessions |
