# Import Grafana configuration and pipelines
#
# Prerequisites:
#   1. Logged in via: octo-cli -c LogIn
#   2. Context set to the target tenant: octo-cli -c Config -tid meshtest
#   3. Communication enabled for the tenant: octo-cli -c EnableCommunication
#
# Usage:
#   ./om_import_grafana_pipelines.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pipelinesDir = Join-Path $scriptDir ".." "pipelines"

Write-Host "Importing Grafana configuration and pipelines..." -ForegroundColor Cyan

# Import GrafanaConfiguration entity (contains connection parameters)
# NOTE: Edit rt-grafana-configuration.yaml with your environment values before importing!
Write-Host "  Importing GrafanaConfiguration..." -ForegroundColor Yellow
octo-cli -c ImportRt -f "$pipelinesDir/rt-grafana-configuration.yaml" -w -r

# Import provision pipeline
Write-Host "  Importing Grafana Provision Tenant pipeline..." -ForegroundColor Yellow
octo-cli -c ImportRt -f "$pipelinesDir/rt-grafana-provision-tenant.yaml" -w -r

# Import deprovision pipeline
Write-Host "  Importing Grafana Deprovision Tenant pipeline..." -ForegroundColor Yellow
octo-cli -c ImportRt -f "$pipelinesDir/rt-grafana-deprovision-tenant.yaml" -w -r

Write-Host ""
Write-Host "Done. Pipelines available in Refinery Studio under Data Pipelines." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open Refinery Studio -> Data Pipelines"
Write-Host "  2. Find 'Grafana - Provision Tenant' and execute it"
Write-Host "  3. This creates a Grafana org and datasource for the current tenant"
Write-Host ""
