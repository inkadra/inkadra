# 0018 · Keep session tokens out of browser-readable auth responses

Accepted, 2026-10.

**Context.** Better Auth 1.7 returns the current session token from `get-session`,
email sign-in/sign-up, social ID-token sign-in, magic-link verification, two-factor
verification and password changes that revoke other sessions. `update-session` can
also return it, although Inkadra configures no writable additional session fields,
so that endpoint currently rejects updates. Exposing these credentials in JSON lets
page JavaScript copy a session beyond the protection of its httpOnly cookie. The web
app uses cookie authentication and never consumes a Better Auth session token.

**Decision.** Configure a Better Auth `onResponse` plugin in the server auth setup
that removes every `token` property from its HTTP JSON responses, including nested
`session.token`. Apply the projection after endpoint and two-factor hooks have
finished, without an endpoint allowlist. Keep status and headers, especially every
`Set-Cookie`; remove the old content length when serializing the projected body.
Non-JSON responses, including OAuth and magic-link redirects, pass through unchanged.

**Consequences.** Server-side `auth.api` calls retain their session tokens for
internal authentication, refresh and revocation. Cookie creation and rotation still
work. The existing disabled `list-sessions` and `revoke-session` paths stay disabled.
Personal tokens and the clipper/mobile PKCE exchange are separate `/api/v1` routes
and retain their documented token responses. The public auth schemas do not promise
a session token, so this requires no contract change. Future Better Auth plugins must
keep session credentials out of page-readable headers and redirect URLs as well as
JSON; any new JSON `token` field is private by default.
