# Configuration

Inkadra reads its settings from the environment. With Compose, put them in `.env` next to
`compose.yaml`; [`.env.example`](../../.env.example) lists them with their defaults. Never commit
or share the real `.env`.

## Server

| Variable        | Default                          | Meaning                                                                                  |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `production`                     | `development`, `production` or `test`                                                    |
| `PUBLIC_URL`    | required                         | Address people use, as served by your proxy, e.g. `https://inkadra.example.com`. No path |
| `AUTH_SECRET`   | required                         | At least 32 random characters: `openssl rand -hex 32`. Changing it signs everyone out    |
| `DATABASE_URL`  | set by compose                   | Postgres connection string                                                               |
| `REDIS_URL`     | set by compose                   | Valkey or Redis connection string. Needed by `worker`, `all` and, for clips, `collab`    |
| `INSTANCE_NAME` | `Inkadra`                        | Name shown in the app                                                                    |
| `REGISTRATION`  | `invite`                         | `invite`: only invited people can sign up. `open`: anyone can                            |
| `HOST`          | `0.0.0.0`                        | Interface the web server listens on                                                      |
| `PORT`          | `3000`                           | Port of the web server                                                                   |
| `COLLAB_PORT`   | `3001`                           | Port of the collaboration server, in split mode                                          |
| `DATA_DIR`      | `/data`                          | Where files live; the `local` driver keeps them in `<DATA_DIR>/files`                    |
| `WEB_DIST`      |                                  | Folder of the built web app; unset for the default next to the server                    |
| `TRUST_PROXY`   | `loopback,linklocal,uniquelocal` | Who may tell Inkadra the client's address. See [below](#trust_proxy)                     |
| `LOG_LEVEL`     | `info`                           | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                     |

## Files and uploads

| Variable               | Default     | Meaning                                                                                    |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `STORAGE_DRIVER`       | `local`     | `local`: files in the data volume. `s3`: files in a bucket. See [Storage](storage.md)      |
| `S3_ENDPOINT`          | AWS         | Address of an S3-compatible service, e.g. `https://s3.eu-central-003.backblazeb2.com`      |
| `S3_REGION`            | `us-east-1` | Region of the bucket                                                                       |
| `S3_BUCKET`            |             | Bucket name                                                                                |
| `S3_ACCESS_KEY_ID`     |             | Access key                                                                                 |
| `S3_SECRET_ACCESS_KEY` |             | Secret key                                                                                 |
| `S3_FORCE_PATH_STYLE`  | `false`     | `true` for MinIO, RustFS, Garage and most self-hosted stores                               |
| `UPLOAD_MAX_SIZE`      | `20GB`      | Largest file anyone can upload, as bytes or with a unit (`500MB`, `4GB`); `0` for no limit |
| `HEIC_PREVIEWS`        | `true`      | `false` stops Inkadra decoding HEIC photos from iPhones: they are kept, without a preview  |

## Compose only

These change `compose.yaml` itself, not the server.

| Variable                  | Default                   | Meaning                                                                        |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `INKADRA_TAG`             | `latest`                  | Image tag: a version such as `0.2.0` (recommended), `latest` or `edge`         |
| `INKADRA_IMAGE`           | `ghcr.io/inkadra/inkadra` | Image name, for a mirror or your own build                                     |
| `INKADRA_PORT`            | `3000`                    | Host port of the web app                                                       |
| `INKADRA_COLLAB_PORT`     | `3001`                    | Host port of `collab`, in split mode                                           |
| `INKADRA_BIND`            | `127.0.0.1`               | Host address the ports listen on. `0.0.0.0` if the proxy is on another machine |
| `INKADRA_DATA`            | volume `inkadra-data`     | Host folder for uploads instead of the volume                                  |
| `POSTGRES_PASSWORD`       | required                  | Password of the bundled Postgres                                               |
| `POSTGRES_DATA`           | volume `postgres-data`    | Host folder for the database                                                   |
| `VALKEY_DATA`             | volume `valkey-data`      | Host folder for Valkey                                                         |
| `RUSTFS_DATA`             | volume `rustfs-data`      | Host folder for the bundled RustFS                                             |
| `INKADRA_DOMAIN`          |                           | Host of `PUBLIC_URL`, for the bundled proxies                                  |
| `INKADRA_COLLAB_UPSTREAM` | `inkadra:3000`            | Where the bundled Caddy and Nginx send `/collab`: `collab:3001` in split mode  |
| `ACME_EMAIL`              |                           | Contact for Let's Encrypt, for the bundled Traefik                             |
| `TRAEFIK_CERTRESOLVER`    | `letsencrypt`             | Which Traefik certresolver gets the certificate, for the bundled Traefik       |
| `NGINX_CERTS`             | `./certs`                 | Folder with `fullchain.pem` and `privkey.pem`, for the bundled Nginx           |

## Sign-in and email

Step by step in [Sign-in](sign-in.md). Every variable is optional.

| Variable                 | Default                | Meaning                                                                           |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`       |                        | OAuth client of type "Web application" in Google Cloud. Shows the Google button   |
| `GOOGLE_CLIENT_SECRET`   |                        | Its secret                                                                        |
| `GOOGLE_ALLOWED_DOMAINS` | any                    | Comma-separated domains whose Google accounts may sign in, e.g. `studio.it`       |
| `OIDC_NAME`              | `SSO`                  | Label of the button of your OpenID Connect provider                               |
| `OIDC_DISCOVERY_URL`     |                        | Its `.well-known/openid-configuration` address                                    |
| `OIDC_CLIENT_ID`         |                        | Client id given by the provider                                                   |
| `OIDC_CLIENT_SECRET`     |                        | Client secret given by the provider                                               |
| `OIDC_SCOPES`            | `openid email profile` | Scopes to ask for                                                                 |
| `OIDC_TRUST_EMAIL`       | `false`                | `true` links OIDC sign-ins to existing accounts with the same email               |
| `SMTP_URL`               |                        | `smtp://user:password@host:587` or `smtps://…:465`. Turns on email                |
| `MAIL_FROM`              |                        | Sender, e.g. `Inkadra <inkadra@example.com>`. Required with `SMTP_URL`            |
| `CLIPPER_EXTENSION_IDS`  |                        | Ids of self-built browser clippers allowed to sign in. The official one always is |

## TRUST_PROXY

Behind a proxy, every request reaches Inkadra from the proxy's address. The proxy puts the
real client address in `X-Forwarded-For`, and Inkadra believes that header only when the
request comes from an address listed in `TRUST_PROXY`. The client address limits sign-in
attempts and appears in the logs, so a wrong value either blocks everyone at once (the proxy
looks like one client) or lets anyone fake an address.

The default trusts loopback and private networks, which covers a proxy on the same machine or
in the same Docker network. Change it when the proxy connects from somewhere else:
- a proxy on another machine of your LAN: its address, e.g. `TRUST_PROXY=192.168.1.10`;
- a proxy that reaches Inkadra over Tailscale, for example Pangolin on a VPS targeting the
  server's Tailscale address: trust only that proxy's exact tailnet address,
  for example `TRUST_PROXY=100.100.10.20`.

Never use `true`: it trusts everyone, so any client could choose its address.

## Authentication and browser hardening

Production authentication requires `REDIS_URL` (the existing Valkey instance). IP, account
and recipient budgets persist across processes and restarts; unavailable Valkey fails closed.
Tests use isolated memory budgets and disable IP/account throttling; recipient limits remain.
Email delivery runs outside the request's awaited SMTP path. Delivery is best effort: process
termination can lose pending messages, and delivery failures are logged without credentials.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CSP_ENFORCE` | `false` | Send CSP in report-only mode; `true` enforces it. Validate your media and integrations first. |
| `HSTS_ENABLED` | `false` | Opt into one-year HSTS, only when `PUBLIC_URL` uses HTTPS. |
| `OIDC_ALLOWED_DOMAINS` | any | Allowed verified email domains for OIDC. Google issuers use the verified `hd` claim and fall back to `GOOGLE_ALLOWED_DOMAINS`. |

Magic links and Google/OIDC callbacks require the same second factor as password sign-in.
After a browser callback the challenge opens at `/login?twoFactor=true`; no full session is
retained until verification. Existing trusted-device cookies retain Better Auth semantics.
Personal token and app authorization creation need a cookie session younger than 15 minutes.
Personal tokens default to 90 days, including an omitted or null expiry; explicit lifetimes
retain the existing API maximum of 3650 days. Password changes/reset revoke non-app personal
tokens; reset also revokes every browser session. App tokens retain their existing lifecycle.
