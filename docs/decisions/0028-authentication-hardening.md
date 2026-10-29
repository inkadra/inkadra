# 0028 — Authentication hardening

## Context

The Better Auth 1.7.12 two-factor hook matches password endpoints, leaving browser email
links and OAuth callbacks outside its challenge. Long-lived sessions and personal tokens
also allow sensitive account actions without recent authentication. SMTP latency can reveal
whether an address exists.

## Decision

Extend the upstream two-factor plugin's hook matcher instead of implementing a second
challenge protocol. Its signed cookie, expiring verification record, attempt counter,
trusted-device handling and TOTP/backup-code endpoints remain authoritative. Browser callbacks
redirect to the existing login challenge after the provisional session is deleted. Include
social ID-token sign-in, too. Integration regressions must cover Google, OIDC and magic links;
upgrades must preserve this wrapper's assumptions.

Use atomic Valkey budgets with hashed keys and expiring counters, namespaced by instance URL
and auth secret so independent deployments sharing Valkey cannot spend each other's budgets. Before password checks,
read failure counts; only 401 responses increment them. Limit each account/source subnet pair (IPv4 /24, IPv6 /64) to ten
failures per 15 minutes, with a wide account ceiling of 50 failures/hour against distributed
attacks. The ceiling can still be abused to deny access temporarily; pairing the tighter
limit with the source subnet avoids allowing one anonymous attacker ten requests to block every source.
Concurrent failures can overshoot a read budget; the separate 30 requests/minute per-IP,
per-endpoint burst bound limits that race. NAT users share the burst budget; configure
TRUST_PROXY correctly. Successful passwords clear counters only without 2FA; clear after
successful second-factor verification otherwise. TOTP attempts also have a per-user budget.

Keep sessions and verification records in Postgres. Production, including the web role,
requires REDIS_URL at startup. Limiter failures return 503 only for sign-in, reset and 2FA;
session lookup and sign-out remain available. Tests use Valkey whenever REDIS_URL is set,
otherwise bounded memory with eviction. E2e explicitly uses NODE_ENV=development and
AUTH_RATE_LIMITS=off; production ignores that switch. Integration security tests keep limits on.
Before sign-up reject closed registration before user lookup, except setup/invitations.
Open registration and valid invitations still reveal existing accounts at sign-up.

Count recipient budgets only in actual mail delivery callbacks (three per 15 minutes),
shared across reset and magic links. This can deny mail to a recipient temporarily and is
accepted for small teams. Detach magic-link lookup and SMTP from the response; process
crashes may lose pending delivery. Hash magic-link tokens at rest. Disable unused access-token and user
update endpoints; account editing and normalized avatar upload remain in the validated API.
Domain restrictions run on verified provider profiles, including existing linked users.
Google requires its hosted-domain claim even for linked accounts; generic OIDC requires a verified email (boolean true or the string "true", including Cognito) when a domain allowlist is configured.

Require recent cookie sessions for PAT/app authorization issuance; admin operations reject
PATs. Default personal tokens to 90 days while preserving the existing explicit maximum.
Password reset revokes browser sessions; reset revokes all tokens including app-bound tokens; password changes revoke non-app tokens.
Send localized notifications for token creation, password changes and disabling two-factor.

Start CSP in report-only mode with an explicit enforcement switch. Externalize the theme
script; derive websocket and S3 origins from configuration. Send Permissions-Policy and COOP;
HSTS requires HTTPS plus opt-in. TLS redirect and restricted proxy trust remain owner-operated.

## Consequences

No API, DB or board-schema contract changes are needed. Null PAT expiry now receives the
secure default, without changing the shared input schema. Removing public version fields
requires a separate contract PR and is deferred. Existing non-expiring tokens remain until
revoked. Clients creating tokens from old sessions must sign in again. Browser callbacks
return to login after 2FA with the original same-origin destination preserved. Report-only CSP
does not block resources; operators must validate and explicitly enable enforcement.

Non-admin classification reads continue accepting PATs; admin mutations and diagnostics require cookies. Reauthentication errors use the existing forbidden code with details.reason=reauth_required (ADR 0016).
