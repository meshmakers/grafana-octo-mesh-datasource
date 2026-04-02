# Setup Grafana Datasource OAuth Client in Identity Server
#
# Prerequisites:
#   1. Identity Service running locally (https://localhost:5003)
#   2. Logged in via: octo-cli -c LogIn
#   3. Context set to the target tenant: octo-cli -c Config -tid meshtest
#
# This script creates TWO clients:
#   - grafana-test:       Grafana's own OAuth login (user logs into Grafana UI)
#   - grafana-datasource: Plugin backend OAuth (per-tenant API token acquisition)
#
# Usage:
#   # Setup both clients for tenant "meshtest"
#   ./om-setupIdentityService-local.ps1
#
# Note: Run this script once per tenant where Grafana users need access.
#       Switch tenant context before each run:
#         octo-cli -c Config -tid meshtest
#         ./om-setupIdentityService-local.ps1
#         octo-cli -c Config -tid sbeg
#         ./om-setupIdentityService-local.ps1

Write-Host ""
Write-Host "=== Grafana OAuth Client Setup ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. Grafana Login Client (grafana-test) ---
# Used by Grafana's built-in generic_oauth for user login to the Grafana UI.
# The tenant discovery flow in Identity Server handles tenant selection.

Write-Host "Creating Grafana login client (grafana-test)..." -ForegroundColor Yellow

$grafanaLoginClientId = "grafana-test"
$grafanaUrl = "http://localhost:3000/"

octo-cli -c AddAuthorizationCodeClient `
    --clienturi $grafanaUrl `
    --clientid $grafanaLoginClientId `
    --redirectUri "$($grafanaUrl)login/generic_oauth" `
    --name "Grafana"

# Add allowed_tenants scope for Grafana org_mapping
# Note: octo_api scope is added automatically by AddAuthorizationCodeClient
octo-cli -c AddScopeToClient --clientid $grafanaLoginClientId --name "allowed_tenants"

Write-Host "  -> Client '$grafanaLoginClientId' created" -ForegroundColor Green

# --- 2. Grafana Datasource Client (grafana-datasource) ---
# Used by the Go backend plugin for per-tenant API token acquisition via acr_values.
# The callback URL uses Grafana's datasource proxy path.

Write-Host "Creating Grafana datasource client (grafana-datasource)..." -ForegroundColor Yellow

$grafanaDsClientId = "grafana-datasource"

# Get current tenant from octo-cli config for deterministic datasource UID
$currentTenant = octo-cli -c Config --show-tenant 2>$null
if ([string]::IsNullOrEmpty($currentTenant)) {
    $currentTenant = Read-Host "Enter the tenant ID for this client"
}
# The datasource UID is deterministic: octomesh-{tenantId}
$callbackUri = "$($grafanaUrl)api/datasources/uid/octomesh-$currentTenant/resources/auth/callback"

Write-Host "  Callback URI: $callbackUri" -ForegroundColor DarkGray

octo-cli -c AddAuthorizationCodeClient `
    --clienturi $grafanaUrl `
    --clientid $grafanaDsClientId `
    --redirectUri $callbackUri `
    --name "Grafana Datasource"

# Note: octo_api scope is added automatically by AddAuthorizationCodeClient

Write-Host "  -> Client '$grafanaDsClientId' created" -ForegroundColor Green

# --- 3. Grafana Service Account (for auto-creating organizations) ---
# Only needs to run once per Grafana instance, not per tenant.

Write-Host "Creating Grafana service account for org management..." -ForegroundColor Yellow

$grafanaAdminAuth = "admin:admin"
$grafanaApiUrl = "http://localhost:3000"

# Create service account
$saResponse = Invoke-RestMethod -Uri "$grafanaApiUrl/api/serviceaccounts" `
    -Method Post `
    -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($grafanaAdminAuth)) } `
    -ContentType "application/json" `
    -Body '{"name":"octo-mesh-plugin","role":"Admin"}' `
    -ErrorAction SilentlyContinue

if ($saResponse.id) {
    # Create token for the service account
    $tokenResponse = Invoke-RestMethod -Uri "$grafanaApiUrl/api/serviceaccounts/$($saResponse.id)/tokens" `
        -Method Post `
        -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($grafanaAdminAuth)) } `
        -ContentType "application/json" `
        -Body '{"name":"octo-mesh-plugin-token"}'

    Write-Host "  -> Service account created. Token: $($tokenResponse.key)" -ForegroundColor Green
    Write-Host "  -> Set GRAFANA_SA_TOKEN=$($tokenResponse.key) in docker-compose or datasource config" -ForegroundColor Yellow
} else {
    Write-Host "  -> Service account may already exist (skipped)" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. If you have more tenants, switch context and run this script again:"
Write-Host "       octo-cli -c Config -tid <other-tenant>"
Write-Host "       ./om-setupIdentityService-local.ps1"
Write-Host ""
Write-Host "  2. Configure Grafana OAuth in docker-compose or grafana.ini:"
Write-Host "       GF_AUTH_GENERIC_OAUTH_CLIENT_ID=grafana-test"
Write-Host "       GF_AUTH_GENERIC_OAUTH_SCOPES=openid profile email role allowed_tenants octo_api"
Write-Host ""
Write-Host "  3. Configure the OctoMesh datasource in Grafana:"
Write-Host "       Identity Server URL: https://localhost:5003"
Write-Host "       Client ID: grafana-datasource"
Write-Host "       Tenant ID: <your-tenant>"
Write-Host "       Service Account Token: (from step above)"
Write-Host ""
