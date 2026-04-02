# Remove Grafana OAuth Clients from Identity Server
#
# Prerequisites:
#   1. Identity Service running locally (https://localhost:5003)
#   2. Logged in via: octo-cli -c LogIn
#   3. Context set to the target tenant: octo-cli -c Config -tid meshtest
#
# Usage:
#   ./om-removeIdentityService.ps1

Write-Host "Removing Grafana OAuth clients..." -ForegroundColor Yellow

octo-cli -c DeleteClient --clientid grafana-test --yes
octo-cli -c DeleteClient --clientid grafana-datasource --yes

Write-Host "Done." -ForegroundColor Green
