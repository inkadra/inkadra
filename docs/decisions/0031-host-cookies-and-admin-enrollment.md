# 0031 — Host cookies and administrator enrollment

## Context

Audit #225 identifies sibling-domain cookie injection and administrators without a second
factor. Better Auth 1.7 prepends `__Secure-` even to explicit cookie names.

## Decision

Own the complete cookie names and Secure attribute; use `__Host-inkadra.*` on HTTPS only.
Better Auth configures one session-cookie name and has no native legacy-name alias. A custom
bridge would need to rewrite cookies consistently across auth, REST and collaboration.
Do not accept legacy HTTPS cookies: this deliberately requires one sign-in after upgrade
rather than preserving the injection surface during a migration. Document this in the
self-hosting upgrade notes. HTTP development remains unprefixed.

Enforce the existing JSON administration policy at actor/session resolution and on
collaboration authentication/rechecks, including bearer tokens. Keep GET /me available to
render enrollment. Better Auth enrollment and recovery endpoints stay available, with
the existing attempt budgets. Disabling 2FA while required returns the administrator to
enrollment. The separate contract PR exposes the policy setting; enforcement reads its
persisted boolean independently and defaults to off.

## Consequences

Use Better Auth’s native `allowPasswordless` enrollment for accounts with no credential
password. Their authenticated identity-provider session authorizes enrollment; credential
accounts still require their password (verified by the upstream credential-account lookup).
TOTP verification remains mandatory before `twoFactorEnabled` becomes true. Administrators
should enroll before activation and retain backup codes.
Existing sockets are closed at the next access recheck. Custom mobile URI schemes remain
an acknowledged risk pending verified HTTPS links; PKCE alone cannot verify app ownership.

## Review follow-up

Provider-only sessions authorize sensitive 2FA operations only within `FRESH_SIGN_IN_MS`
(15 minutes from the original sign-in), not merely because a session is still valid.
Credential accounts retain upstream password confirmation. This covers secret retrieval,
backup-code viewing/regeneration and enabling/disabling 2FA.

Activation requires an already enrolled administrator (validated in the contract PR).
A host-only `admin-2fa off` command disables the policy atomically in the existing JSON
row while preserving all other settings. It has no HTTP equivalent. Signing out and
revoking owned sessions/tokens remain possible during mandatory enrollment.
