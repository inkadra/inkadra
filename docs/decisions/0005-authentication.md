# 0005 · Better Auth, first account is administrator

Accepted, 2026-10.

**Context.** Self-hosters expect email and password out of the box, Google and generic OIDC
later, and app tokens for the extension and mobile app.

**Decision.** Better Auth with its Drizzle adapter, mounted at `/api/auth`, with UUID ids and
cookies prefixed `inkadra`. Wave 0 enables email and password (10 to 128 characters). The first
account of an instance becomes `admin`; after that sign-up is refused unless
`REGISTRATION=open` (invitations arrive in wave 2). Google, OIDC, magic links, 2FA and personal
tokens are added in wave 2 on the same base. Better Auth telemetry is disabled.

**Consequences.** Until invitations exist, an administrator who wants more accounts sets
`REGISTRATION=open` temporarily. The first-account rule must stay behind a fresh install: put
the instance behind the proxy only after creating the administrator, or keep it private until then.
