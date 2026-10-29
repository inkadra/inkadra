# Configuration

Inkadra reads its settings from the environment. With Compose, put them in `.env` next to
`compose.yaml`; [`.env.example`](../../.env.example) lists them with their defaults. Never commit
or share the real `.env`.

## Server

| Variable        | Default                          | Meaning                                                                                          |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_ENV`      | `production`                     | `development`, `production` or `test`                                                            |
| `PUBLIC_URL`    | required                         | Address people use, as served by your proxy, e.g. `https://inkadra.example.com`. No path         |
| `AUTH_SECRET`   | required                         | At least 32 random characters: `openssl rand -hex 32`. Changing it signs everyone out            |
| `DATABASE_URL`  | set by compose                   | Postgres connection string                                                                       |
| `REDIS_URL`     | set by compose                   | Valkey or Redis connection string. Required in production by `web`, `worker`, `all` and `collab` |
| `INSTANCE_NAME` | `Inkadra`                        | Name shown in the app                                                                            |
| `REGISTRATION`  | `invite`                         | `invite`: only invited people can sign up. `open`: anyone can                                    |
| `HOST`          | `0.0.0.0`                        | Interface the web server listens on                                                              |
| `PORT`          | `3000`                           | Port of the web server                                                                           |
| `COLLAB_PORT`   | `3001`                           | Port of the collaboration server, in split mode                                                  |
| `DATA_DIR`      | `/data`                          | Where files live; the `local` driver keeps them in `<DATA_DIR>/files`                            |
| `WEB_DIST`      |                                  | Folder of the built web app; unset for the default next to the server                            |
| `TRUST_PROXY`   | `loopback,linklocal,uniquelocal` | Who may tell Inkadra the client's address. See [below](#trust_proxy)                             |
| `LOG_LEVEL`     | `info`                           | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                             |

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
| `INKADRA_TAG`             | `latest`                  | Image tag: a version such as `0.4.0` (recommended), `latest` or `edge`         |
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
| `GOOGLE_ALLOWED_DOMAINS` | any                    | Comma-separated Google Workspace domains that may sign in, e.g. `studio.it`       |
| `OIDC_NAME`              | `SSO`                  | Label of the button of your OpenID Connect provider                               |
| `OIDC_DISCOVERY_URL`     |                        | Its `.well-known/openid-configuration` address                                    |
| `OIDC_CLIENT_ID`         |                        | Client id given by the provider                                                   |
| `OIDC_CLIENT_SECRET`     |                        | Client secret given by the provider                                               |
| `OIDC_SCOPES`            | `openid email profile` | Scopes to ask for                                                                 |
| `OIDC_TRUST_EMAIL`       | `false`                | `true` links OIDC sign-ins to existing accounts with the same email               |
| `OIDC_ALLOWED_DOMAINS`   | any                    | Comma-separated email domains whose verified OIDC accounts may sign in            |
| `SMTP_URL`               |                        | `smtp://user:password@host:587` or `smtps://…:465`. Turns on email                |
| `MAIL_FROM`              |                        | Sender, e.g. `Inkadra <inkadra@example.com>`. Required with `SMTP_URL`            |
| `CLIPPER_EXTENSION_IDS`  |                        | Ids of self-built browser clippers allowed to sign in. The official one always is |

Allowed domains are checked on every sign-in, also for people who already have an account:
- **Google** checks the `hd` claim, the Workspace domain Google itself vouches for. A personal
  `@gmail.com` account has no `hd`, so with `GOOGLE_ALLOWED_DOMAINS` set it cannot sign in,
  even if it was linked before.
- **OIDC** checks the domain of the email address, and only accepts it when the provider marks
  it verified (`email_verified` set to `true`, or the string `"true"`). Without
  `OIDC_ALLOWED_DOMAINS` there is no domain check. If `OIDC_DISCOVERY_URL` points at Google
  (`accounts.google.com`), the `hd` claim is checked instead, against `OIDC_ALLOWED_DOMAINS` or,
  when that is empty, `GOOGLE_ALLOWED_DOMAINS`.

## TRUST_PROXY

Behind a proxy, every request reaches Inkadra from the proxy's address. The proxy puts the
real client address in `X-Forwarded-For`, and Inkadra believes that header only when the
request comes from an address listed in `TRUST_PROXY`. The client address limits sign-in
attempts and appears in the logs, so a wrong value either blocks everyone at once (the proxy
looks like one client) or lets anyone fake an address.

The value is `false`, or a comma-separated list of addresses, CIDR ranges and the presets
`loopback`, `linklocal` and `uniquelocal` (private networks). The default trusts loopback and
every private network, which works for a proxy on the same machine or in the same Docker
network. It is a starting point, not the safest setting: anything else on those networks could
claim any client address. Once the proxy works, narrow it to **the proxy's own address or its
dedicated subnet**:
- a proxy in the same Docker network: that network's subnet, from
  `docker network inspect inkadra_default --format '{{(index .IPAM.Config 0).Subnet}}'`,
  e.g. `TRUST_PROXY=172.18.0.0/16`. Pin the subnet in compose if you rely on it;
- a proxy on the same machine, reaching the published port: `TRUST_PROXY=loopback`;
- a proxy on another machine of your LAN: its address, e.g. `TRUST_PROXY=192.168.1.10`;
- a proxy that reaches Inkadra over Tailscale, for example Pangolin on a VPS targeting the
  server's Tailscale address: only that proxy's tailnet address, e.g.
  `TRUST_PROXY=100.100.10.20`, not the whole `100.64.0.0/10` range.

Never use `true`: it trusts everyone, so any client could choose its address.

## Sign-in limits

Inkadra limits sign-in, sign-up, password reset, email links and two-factor attempts per
client network, per account and per email recipient. The counters live in Valkey (`REDIS_URL`),
so they hold across restarts and across containers in split mode.

- **`REDIS_URL` is required in production by every role**, `web` included: without it the
  server does not start. `compose.yaml` sets it to the bundled Valkey.
- If Valkey is unreachable, the endpoints above answer `503` instead of letting attempts through;
  people who are already signed in stay signed in and can sign out.
- After a successful sign-in over HTTPS, the browser gets a signed _known device_ cookie valid 90
  days. When an account is locked because of too many failed attempts, a known device can still
  try, within its own budget (five failures in 15 minutes). The cookie never skips the password
  or the second factor. Changing `AUTH_SECRET` invalidates every one.
- `AUTH_RATE_LIMITS=off` turns the limits off, for isolated end-to-end tests only: it is ignored
  when `NODE_ENV=production`, which is the image's default.

### Unlocking an account

If someone is locked out by failed attempts and cannot wait for the counters to expire, an
administrator of the server (not of the app: there is no web page for this) can clear them:

```sh
docker compose exec inkadra node /app/dist/main.js unlock-auth person@example.com
# also clear that address's counters for one client network:
docker compose exec inkadra node /app/dist/main.js unlock-auth person@example.com 192.0.2.10
```

It clears the account and email counters of that address in this instance's Valkey. It does not
change the password, sessions or two-factor settings, and it does not lift the per-network limits
of other addresses.

## Browser security headers

Inkadra sends `Content-Security-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy: same-origin` on its pages. Two of them are opt-in, because a wrong
setting can break an installation in ways the server cannot see:

| Variable         | Default | Meaning                                                                                       |
| ---------------- | ------- | --------------------------------------------------------------------------------------------- |
| `CSP_ENFORCE`    | `false` | `false` sends the policy as `Content-Security-Policy-Report-Only`; `true` enforces it          |
| `CSP_REPORT_URI` |         | Absolute address that receives violation reports, e.g. `https://reports.example.com/csp`      |
| `HSTS_ENABLED`   | `false` | `true` sends `Strict-Transport-Security: max-age=31536000`, only when `PUBLIC_URL` is `https` |

The policy allows the instance itself, its WebSocket, the S3 bucket when files are in S3,
Google profile pictures and the privacy-enhanced YouTube player. To move to enforcement, see
[Upgrades](upgrades.md#trying-csp-enforcement). HSTS is usually better set at the proxy, which
also redirects HTTP to HTTPS: see [Reverse proxy](reverse-proxy.md#security-headers).

## Personal tokens and second factor

- With two-factor authentication on, every way of signing in asks for the second factor: password,
  email link, Google and OIDC.
- Creating a personal token or authorizing an app needs a session younger than 15 minutes: sign
  in again if it is older.
- Personal tokens expire after 90 days unless a lifetime is chosen (at most 3650 days). Changing
  the password revokes personal tokens but not app tokens; a password reset revokes every token
  and signs out every browser.
- Email is sent in the background: a container stopped at the wrong moment can lose a message
  that was about to go out, and failures are logged without credentials.
