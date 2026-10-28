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

Use an atomic Valkey counter through Better Auth's custom rate-limit storage, plus separate
normalized-address budgets. Reserve account attempts before password verification and release
on successful sign-in; concurrent failures cannot pass an unreserved budget. No account lookup
is used by this limit. Hash all Redis keys and expire budgets. Keep sessions and verification
records in Postgres: introducing a secondary session cache would undermine direct revocation.
Production requires the existing REDIS_URL; tests remain isolated in memory. Before sign-up,
reject closed registration before Better Auth's user lookup, except initial setup/invitations.

Bound auth email requests per normalized recipient before account lookup and detach SMTP
from the response. This is deliberately best effort, not a durable mail queue: a process
crash may lose delivery. Hash magic-link tokens at rest. Disable unused access-token and user
update endpoints; account editing and normalized avatar upload remain in the validated API.
Domain restrictions run on verified provider profiles, including existing linked users.
Google requires its hosted-domain claim, generic OIDC a verified email and explicit allowlist.

Require recent cookie sessions for PAT/app authorization issuance; admin operations reject
PATs. Default personal tokens to 90 days while preserving the existing explicit maximum.
Password reset revokes browser sessions; reset and password changes revoke non-app tokens.
Send localized notifications for token creation, password changes and disabling two-factor.

Start CSP in report-only mode with an explicit enforcement switch. Externalize the theme
script; derive websocket and S3 origins from configuration. Send Permissions-Policy and COOP;
HSTS requires HTTPS plus opt-in. TLS redirect and restricted proxy trust remain owner-operated.

## Consequences

No API, DB or board-schema contract changes are needed. Null PAT expiry now receives the
secure default, without changing the shared input schema. Removing public version fields
requires a separate contract PR and is deferred. Existing non-expiring tokens remain until
revoked. Clients creating tokens from old sessions must sign in again. Browser callbacks
currently return to login after 2FA, so a deep-link destination may be lost. Report-only CSP
does not block resources; operators must validate and explicitly enable enforcement.
