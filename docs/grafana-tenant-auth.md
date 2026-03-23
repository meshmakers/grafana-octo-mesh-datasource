# Grafana OctoMesh Datasource: Tenant-spezifische Authentifizierung

## Problemstellung

Die Grafana OctoMesh Datasource wurde entwickelt, bevor OctoMesh tenant-spezifische Authentifizierung eingeführt hat. Heute enthält jeder OAuth-Token einen `tenant_id` Claim, der den Tenant identifiziert, über den der User sich eingeloggt hat. Die `TenantAuthorizationMiddleware` in OctoMesh erzwingt, dass dieser `tenant_id` mit dem Tenant in der API-Route übereinstimmt — andernfalls wird die Anfrage mit **403 Forbidden** abgelehnt.

Die Grafana Datasource authentifiziert sich über Grafana's Generic OAuth-Mechanismus (`oauthPassThru`). Da Grafana nur **eine einzige globale OAuth-Konfiguration** unterstützt, wird der Token immer gegen den System-Tenant ausgestellt (`tenant_id: OctoSystem`). Sobald die Datasource Daten eines anderen Tenants abfragt (z.B. `/tenants/TenantA/graphql`), schlägt die Tenant-Autorisierung fehl.

Zusätzlich relevant: Die API-Scopes (`octo_api_full_access`, `octo_api_readonly`) werden ausgewertet und bestimmen, ob ein Client lesend oder schreibend zugreifen kann. Diese Scopes stammen aus der OAuth-Client-Konfiguration des Login-Tenants und könnten sich von der Client-Konfiguration des Ziel-Tenants unterscheiden.

## Warum Grafana Organisationen nicht ausreichen

Ein naheliegender Ansatz wäre, pro OctoMesh-Tenant eine Grafana Organisation anzulegen, jeweils mit eigener OAuth-Konfiguration gegen den jeweiligen Tenant. Grafana unterstützt jedoch **nicht mehrere Konfigurationen desselben Auth-Provider-Typs**:

> *"It is not possible to configure the same type of authentication provider twice. For example, you can have SAML and Generic OAuth configured, but you cannot have two different Generic OAuth configurations."*
> — [Grafana Dokumentation](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/)

Da OctoMesh als Identity Provider über Generic OAuth angebunden wird, kann es pro Grafana-Instanz nur eine einzige OctoMesh-OAuth-Konfiguration geben — unabhängig von der Anzahl der Grafana Organisations.

## Option 1: Separate Grafana-Instanz pro Tenant

Jeder OctoMesh-Tenant erhält eine eigene Grafana-Instanz mit eigener OAuth-Konfiguration.

**Umsetzung:**
- OAuth-Config jeder Instanz zeigt auf den jeweiligen Tenant (`/{tenantId}/login`, `acr_values=tenant:{tenantId}`)
- Token hat korrekten `tenant_id` und korrekte Scopes
- Plugin-Code bleibt unverändert

**Vorteile:**
- Keine Code-Änderungen an Plugin oder Server
- Saubere Isolation (Dashboards, User, Berechtigungen)
- Korrekte Scopes und Rollen pro Tenant

**Nachteile:**
- Operativer Overhead: N Instanzen provisionieren, updaten, monitoren
- Kein zentrales Dashboard über Tenants hinweg möglich
- Widerspricht dem Ziel einer einzelnen Grafana-Instanz

**Aufwand:** Kein Entwicklungsaufwand, aber laufender Betriebsaufwand.

## Option 2: Client Credentials pro Datasource (Service Account)

Das Plugin wird zu einem Backend-Plugin (Go) umgebaut. Jede Datasource-Instanz speichert eigene OAuth-Client-Credentials (`client_id` + `client_secret`) und authentifiziert sich per Client Credentials Grant direkt gegen den konfigurierten Tenant.

**Umsetzung:**
- Admin legt pro Tenant eine Datasource an und trägt Client-Credentials ein
- Plugin-Backend holt sich eigenständig einen Token für den Tenant
- Kein `oauthPassThru` mehr — Token wird vom Plugin selbst verwaltet

**Vorteile:**
- Keine Server-Änderung an OctoMesh nötig
- Token hat korrekten `tenant_id` und korrekte Scopes
- Unabhängig vom eingeloggten Grafana-User

**Nachteile:**
- **User-Identität geht verloren** — alle Queries laufen unter dem Service Account; Audit-Trail zeigt nicht den tatsächlichen User
- Plugin muss als Go-Backend-Plugin neu implementiert werden (erheblicher Umbau)
- Client-Secrets müssen pro Datasource verwaltet und rotiert werden

**Aufwand:** Mittel bis groß (Go-Backend-Plugin, Token-Management, Secrets-Verwaltung).

## Option 3: Token Exchange (RFC 8693)

Das Plugin wird zu einem Backend-Plugin (Go) umgebaut. Der User loggt sich weiterhin via OAuth ein (System-Tenant). Das Plugin-Backend tauscht den User-Token serverseitig gegen einen tenant-spezifischen Token aus. Dafür wird ein Token Exchange Endpoint im OctoMesh Identity Server benötigt.

**Umsetzung:**
- Identity Server: Neuer Extension Grant Handler für `urn:ietf:params:oauth:grant-type:token-exchange`
- Der Handler validiert den Original-Token, prüft `allowed_tenants`, löst Rollen und Scopes für den Ziel-Tenant auf, und stellt einen neuen Token aus
- Plugin-Backend: Nimmt den User-Token, ruft Token Exchange auf, cached den Ergebnis-Token, leitet Requests weiter

**Vorteile:**
- **User-Identität bleibt erhalten** — jede Query ist dem eingeloggten User zugeordnet
- Token hat korrekten `tenant_id`, korrekte Rollen und korrekte Scopes
- Sauberste Lösung aus Sicherheitsperspektive
- Zukunftssicher auch wenn API-Autorisierung erweitert wird

**Nachteile:**
- Aufwand auf beiden Seiten (Identity Server + Go-Backend-Plugin)
- Duende IdentityServer 7.4.7 unterstützt Extension Grants nativ, aber der Handler muss implementiert werden (~200-300 Zeilen C#)
- ~70-80% der benötigten Server-Infrastruktur existiert bereits (Tenant-Resolution, AllowedTenantsResolver, UserProfileService)

**Aufwand:** Groß (Extension Grant Handler + Go-Backend-Plugin + Tests), aber die bestehende Infrastruktur reduziert den Server-seitigen Aufwand deutlich.

## Option 4: `allowed_tenants` Middleware-Relaxierung

Die `TenantAuthorizationMiddleware` in OctoMesh wird angepasst, sodass neben `tenant_id` auch der `allowed_tenants` Claim geprüft wird. Ein Token vom System-Tenant kann dann für alle Tenants verwendet werden, für die der User berechtigt ist.

**Umsetzung:**
- Einzeilige Änderung in `TenantAuthorizationMiddleware`: Zusätzlich zum `tenant_id`-Check wird geprüft, ob der Route-Tenant in `allowed_tenants` enthalten ist
- Plugin bleibt Frontend-only (kein Go-Backend nötig)
- Eine Datasource pro Tenant, `oauthPassThru` leitet den bestehenden Token weiter

**Vorteile:**
- Minimaler Aufwand (eine Middleware-Änderung)
- User-Identität bleibt erhalten
- Kein Plugin-Umbau nötig

**Nachteile:**
- **Scopes stammen aus dem System-Tenant** — wenn der OAuth-Client im Ziel-Tenant andere Scopes haben sollte als im System-Tenant, greifen die falschen Berechtigungen (z.B. `full_access` statt `readonly`)
- **Rollen stammen aus dem System-Tenant** — aktuell nicht relevant für die API, aber bei zukünftiger Erweiterung der Autorisierung ein Problem
- Leicht gelockerte Sicherheit: Ein gestohlener Token ermöglicht Zugriff auf alle `allowed_tenants`, nicht nur den Login-Tenant
- Nicht zukunftssicher wenn die API-Autorisierung erweitert wird

**Aufwand:** Klein.

## Zusammenfassung

| | Instanzen | Plugin-Umbau | Server-Umbau | User-Identität | Korrekte Scopes | Aufwand |
|---|---|---|---|---|---|---|
| **1. Separate Instanzen** | N | Keiner | Keiner | Ja | Ja | Ops |
| **2. Client Credentials** | 1 | Go-Backend | Keiner | **Nein** | Ja | Mittel |
| **3. Token Exchange** | 1 | Go-Backend | Extension Grant | Ja | Ja | Groß |
| **4. allowed_tenants** | 1 | Minimal | 1 Middleware | Ja | **Nein*** | Klein |

*\*Scopes und Rollen stammen aus dem System-Tenant, nicht dem Ziel-Tenant.*
