# 0035 — Request origins and canonical links

## Context

One instance must remain usable through its public HTTPS proxy and directly through LAN
or Tailscale HTTP addresses, without enumerating those addresses. This amends 0031's
installation-wide cookie policy; its HTTPS host-cookie protection remains intact.

## Decision

Derive the browser origin from Host and the socket protocol. Accept X-Forwarded-Host and
X-Forwarded-Proto only from the immediate peer allowed by TRUST_PROXY, for HTTP and WebSocket
upgrades alike. Overwrite private auth bridge metadata and strip forwarded headers before
authentication. Never infer transport security from Origin or PUBLIC_URL.

Use two immutable Better Auth configurations, selected for each HTTP request and internal
session lookup. HTTPS uses the existing Secure, host-only __Host-inkadra cookies; HTTP uses
unprefixed, non-Secure cookies. Do not translate or accept legacy cookies on HTTPS. Invitation
and guest cookies follow the same transport policy (guests retain their scoped path).
Known-device cookies remain HTTPS-only. Sessions are separate per host; signing in once per
address is expected. HTTP and HTTPS on the same hostname still have separate cookie names.

| Use                                                               | Origin policy                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Auth CSRF, REST/guest CSRF, collaboration Origin                  | Request origin or canonical PUBLIC_URL origin                                   |
| Auth/session/invitation/guest cookies; CSP; HSTS                  | Verified request protocol                                                       |
| Browser API calls, uploads, collaboration                         | Relative paths; same request origin                                             |
| Local uploads                                                     | Relative tus Location; no dependency on PUBLIC_URL                              |
| S3 presigned URLs and CSP storage exceptions                      | Configured storage endpoint                                                     |
| Email, password reset, magic links, invitations, share links      | Canonical PUBLIC_URL                                                            |
| Google/OIDC callbacks; two-factor callback destination validation | Canonical PUBLIC_URL                                                            |
| Stored avatar URLs                                                | Canonical in storage; browser API maps local avatar paths to its current origin |
| Instance metadata, diagnostics, rate-limit namespace              | Canonical PUBLIC_URL                                                            |
| Clipper/mobile PKCE redirect allowlists                           | Existing explicit client registrations; no widening                             |

Google/SSO sign-in and account-link buttons are hidden on alternate origins; the sign-in
page explains in Italian and English where to use them. There are no passkeys/WebAuthn
credentials today. A future implementation must retain canonical rpID restrictions.

CSP connect-src uses self plus configured storage. HSTS and upgrade-insecure-requests are
only emitted on verified HTTPS responses, retaining their existing opt-in configuration.

## Security and consequences

No credentialed CORS support is added. An unrelated Origin is rejected for auth and
cookie-authenticated REST writes, guest writes, and browser WebSocket authentication.
PUBLIC_URL remains an explicitly trusted origin. Missing Origin remains allowed only for
existing same-origin Fetch Metadata REST flows or non-browser/token clients as before.
Proxies must overwrite forwarded headers and TRUST_PROXY should name only actual proxy
peers: trusting all private addresses also trusts every LAN client to supply those headers.

DNS rebinding remains possible at the network layer: a hostile domain resolving to the
instance can satisfy Host/Origin equality. It has no cookies for an existing instance host,
so cannot inherit its authenticated sessions. Unauthenticated instance metadata and initial
setup remain reachable; bootstrap the owner before exposing the service. This is not a
host allowlist or a defense against an attacker who already controls local DNS. We keep
address discovery automatic by default; network/firewall restrictions and an allowlist at
the reverse proxy are appropriate where stronger host restrictions are needed.

HTTP LAN access exposes credentials and content in clear text; the owner accepts this
tradeoff. Tailscale encrypts transport between its peers, but HTTP itself remains plain.
Secure contexts required by browser APIs are still unavailable on ordinary HTTP LAN hosts.
Migration 0010 adds a session transport field, defaulting existing sessions to HTTPS.
New sessions record their creation transport; adapter lookups reject the opposite transport
for both HTTP auth endpoints and internal REST/collab session resolution. No cookie migration
is required. Existing HTTPS sessions retain
their names; users sign in separately at each LAN/Tailscale host. Port exposure remains an
operator decision tracked in #225; this change neither deploys nor opens any ports.

### Review follow-up

Keep the default `TRUST_PROXY=loopback,linklocal,uniquelocal` for existing Docker-proxied
installations. Direct LAN exposure requires narrowing it to the single proxy container IP pinned with `ipv4_address` (or the Newt peer), documented prominently in self-hosting guidance.
Private clients otherwise can forge forwarded protocol/host and rate-limit addresses.
Use documentation rather than a runtime warning: an immediate private peer cannot cheaply
be distinguished from a legitimate proxy under this broad trust policy.

Normalize trusted proxy `ws`/`wss` protocols to `http`/`https` for upgrades. Share one
authentication security store and lifecycle across both transport configurations.
Reject unrelated Origin on auth writes even without cookies; without Origin reject
cross-site Fetch Metadata but preserve existing native clients. The missing-cookie
login-CSRF gap also existed on main: its REST CSRF hook excludes auth endpoints and
Better Auth skips trusted-origin validation when no cookie is present.

### Second review follow-up

HTTP cookies ignore port boundaries. Direct HTTP requires a hostname dedicated to Inkadra:
any service on that host can receive or plant session/invitation cookies (including Path
shadowing), enabling fixation/login CSRF without cross-origin requests. HTTPS through
`tailscale serve` is the alternative. Transport binding prevents HTTP-born sessions from
being replayed on HTTPS, including by renaming the cookie; the reverse direction is rejected too.

Trust only the pinned proxy container IP, not the Docker subnet/gateway. Userland-proxy,
hairpin, rootless and IPv6 forwarding can present direct clients as the gateway
(e.g. 172.18.0.1), otherwise granting them forwarded-header trust.

The auth bridge currently rejects foreign-Origin POST callbacks as well. No configured
provider uses OIDC `form_post` today; adding one requires a narrowly scoped callback
exemption with verified OAuth state and form-body handling/tests before enabling it.
