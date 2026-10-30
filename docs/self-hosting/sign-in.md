# Sign-in

Out of the box people sign in with email and password. This page adds Google, your own
OpenID Connect provider (Authentik, Keycloak, Authelia, Pocket ID, Zitadel…) and email, and
explains invitations. Put the variables in `.env` and run `docker compose up -d` again;
the buttons appear on the sign-in page by themselves.

## Who can create an account

The first account becomes the administrator. After that `REGISTRATION=invite` (the default)
lets in only people who open an invitation, whatever method they use to sign up, including
Google. `REGISTRATION=open` lets anyone with access to the address sign up.

Invitations are made from the **Share** dialog of a board or project (editors and owners) or,
by administrators, for the instance alone. An invitation by email works once; an invitation
link works for anyone who opens it until it expires (1 to 90 days) or is revoked. An instance
link made without an expiry works once, for two days. Inviting the address of someone who
already has an account gives them access at once. Without email configured, copy the link and
send it yourself.

A use is counted when the account is about to be created. If creating it then fails (a
database error, for example), that use stays counted: an invitation by email or a single-use
link then reads as used, so send a new invitation.

## Google

1. Open [Google Cloud console](https://console.cloud.google.com/), create a project (or pick
   one) and open **APIs & Services → OAuth consent screen**. Choose **External**, fill in the
   app name and your email. While the app is in **Testing**, add the Google accounts that
   may sign in as test users; publish it when everyone should.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web
   application**. Under **Authorised redirect URIs** add
   `https://<your PUBLIC_URL host>/api/auth/callback/google`, exactly, with `https`.
3. Copy the client id and secret into `.env`:

   ```sh
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-…
   # optional: only accounts of your Google Workspace domain(s)
   GOOGLE_ALLOWED_DOMAINS=studio.it
   ```

With `GOOGLE_ALLOWED_DOMAINS`, Google must vouch for the Workspace domain (`hd`) on every
sign-in: personal `@gmail.com` accounts are refused, even when they were linked before.

People who already have an account can also add Google from **Settings → Sign-in methods**.
Signing in with Google with the same address links it to the existing account automatically,
but only when that account's email is verified — otherwise the sign-in is refused and you
link it yourself from the settings page. An email becomes verified when its owner signs in
once with a link by email or accepts an invitation sent by email (both need email
configured); accounts created with Google start verified. An OIDC provider is auto-linked the
same way when it marks the address as verified (`email_verified`); `OIDC_TRUST_EMAIL=true`
links even when it does not. The account's email has to be verified either way.

## An OpenID Connect provider

In your provider, create an application (client) of type _confidential_ / _web_ with:
- redirect URI `https://<your PUBLIC_URL host>/api/auth/callback/oidc`;
- scopes `openid email profile`;
- authorization code flow (PKCE is used and can be required).

Then:

```sh
OIDC_NAME=Authentik
OIDC_DISCOVERY_URL=https://auth.example.com/application/o/inkadra/.well-known/openid-configuration
OIDC_CLIENT_ID=…
OIDC_CLIENT_SECRET=…
# true only if the provider verifies every email address: links sign-ins to existing accounts
# even without email_verified; the existing account's email must still be verified (see Google)
OIDC_TRUST_EMAIL=false
# optional: only verified addresses of these domains
OIDC_ALLOWED_DOMAINS=studio.it
```

With `OIDC_ALLOWED_DOMAINS`, the provider must mark the address as verified (`email_verified`)
and its domain must be in the list. See [Configuration](configuration.md#sign-in-and-email).

The discovery address is usually the issuer followed by `/.well-known/openid-configuration`
(Authentik: `…/application/o/<slug>/…`, Keycloak: `…/realms/<realm>/…`).

## Email

With `SMTP_URL` and `MAIL_FROM` Inkadra emails invitations, sign-in links ("Send me a link",
valid 15 minutes) and password resets:

```sh
SMTP_URL=smtp://user:password@smtp.example.com:587
MAIL_FROM=Inkadra <inkadra@example.com>
```

Use `smtps://…:465` for TLS from the start. Special characters in the password must be
percent-encoded (`@` → `%40`). Sign-in links are sent only to existing accounts, or to anyone
when registration is open, and the page answers the same either way.

## Two-factor authentication

Everyone can turn on an authenticator app (TOTP) in **Settings → Account**, and gets ten
backup codes for when the phone is not at hand. Once it is on, the code is asked after every way
of signing in: password, email link, Google and OIDC. Administrators cannot turn it off for
someone else yet: keep the backup codes.

## The browser clipper and the mobile app

They sign in through the browser (`/authorize`) and get a token that shows in **Settings →
Account → Apps and tokens**, where it can be revoked. Self-built clippers need their
extension id in `CLIPPER_EXTENSION_IDS`.

A clipper built from source or loaded unpacked has its own extension id, shown in its
settings page under **Extension you built yourself**. Add it, comma-separated if there are
several, and restart:

```sh
CLIPPER_EXTENSION_IDS=abcdefghijklmnopabcdefghijklmnop
```

Without it the `/authorize` page refuses the request: only the redirect address
`https://<id>.chromiumapp.org/auth` of an allowed id receives a code. See
[apps/clipper](../../apps/clipper/README.md) to build and load the extension.

## HTTPS cookies in 0.4.2

HTTPS installations use `__Host-inkadra.*` authentication cookies, with Secure,
Path=/ and no Domain. Better Auth's automatic `__Secure-` prefix is disabled so
it cannot prepend a second prefix. HTTP development keeps the plain `inkadra.*` names.

Upgrading an HTTPS installation requires everyone to sign in once again, and pending
invitations must be claimed again from their original links. Old sessions remain subject
to their normal expiry/revocation, but their old cookie names are no longer accepted.
Accepting the legacy cookie indefinitely would retain the sibling-subdomain cookie
injection risk this change addresses. Bearer tokens are unaffected.

## Mobile redirect schemes

The server allows the custom redirect `inkadra://auth` for the planned mobile app;
`apps/mobile` currently contains planning documentation only. Another application can register
that scheme and intercept the authorization redirect. PKCE binds code redemption to the
initiating app's verifier, but does not prove ownership of the redirect handler or prevent
interception and denial of service. Do not treat a custom scheme as a verified app identity.

The plan is verified HTTPS Android App Links (`assetlinks.json`) and iOS Universal Links
(`apple-app-site-association`) with platform association checks, exact redirect allowlists,
and PKCE retained. Self-hosted origins need their own association files. Until those are
implemented, this risk remains; do not broaden the redirect allowlist as a workaround.

## Administrator enrollment policy

The `requireAdminTwoFactor` administration setting defaults to false. When enabled,
administrators without two-step verification can read their identity and enroll through
Better Auth, but cannot use product APIs, administrator APIs, tokens or collaboration.
They see an enrollment banner instead of the workspace. Keep backup codes for recovery. Accounts without a credential password enroll using their
authenticated provider session; accounts with a password must confirm it. Bootstrap stays available on an empty instance; an existing
policy applies to the first administrator immediately after signup.

### Emergency policy override and recent sign-in

Enable the requirement only after enrolling the administrator who activates it. If nobody
can get past enrollment, an operator can run `inkadra admin-2fa off` with the instance's
database configuration (in Docker: `docker compose exec inkadra node /app/dist/main.js admin-2fa off`,
in both all-in-one and split mode). This disables only the policy and preserves other
settings and all personal second factors. Reload the browser afterwards. `unlock-auth`
only clears attempt budgets and is not this override.

Provider-only accounts need a sign-in less than 15 minutes old to enable/disable 2FA,
retrieve the TOTP URI or read/regenerate backup codes. Password accounts still confirm
their password. While enrollment is required, signing out, listing and revoking owned
sessions and tokens remain available. These read-only lists never expose session tokens
or token secrets; they do not allow reading or revoking another account’s credentials.

## Public instance metadata in 0.4.2

`GET /api/v1/health` and `GET /api/v1/instance` no longer return `version`. Integrations
must tolerate its absence. Signed-in clients can use `GET /api/v1/instance/version`;
administrator diagnostics retain their version field. This is an intentional security
change to v1 in 0.4.2 (issue #225).

## Signing in through a private address

The same instance supports its public HTTPS URL and direct HTTP LAN/Tailscale addresses
(such as `http://soyo:7340`) without listing them in configuration. Publish the port on the
appropriate interface; `INKADRA_BIND=0.0.0.0` makes it reachable on the LAN. Keep
`PUBLIC_URL` set to the public HTTPS address. Email/password, sessions, uploads and
collaboration use the current browser address. Sign in once per hostname.

Google and SSO buttons are hidden away from the canonical address, with a link to sign in
there: their registered callback URI and state cookies belong to the public address.
Magic links, invitation and share links also open the canonical address. To use an invitation
or share link privately, replace just its origin with the private address, preserving its
path and token. Plain HTTP sends credentials in clear text; use a trusted LAN or Tailscale.
Existing HTTPS sessions keep their Secure `__Host-` cookies; no migration is needed.
