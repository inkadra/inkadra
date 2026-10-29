# Upgrades

Inkadra follows [semantic versioning](https://semver.org). Before 1.0, a minor version (0.2 →
0.3) can change things you need to act on; the release notes say what. From 1.0 on, only a
major version does.

## Updating

Pin a version in `.env`, so an upgrade happens when you decide:

```sh
INKADRA_TAG=0.4.0
```

To move to a new version, read its [release notes](https://github.com/inkadra/inkadra/releases),
back up (see [Backups](README.md#backups)), change `INKADRA_TAG` and run

```sh
docker compose pull
docker compose up -d
```

Database migrations run when the new version starts, before it accepts requests. Compare your
`compose.yaml` and `deploy/` files with the ones attached to the release: new settings arrive
there.

Going back to an older version after its migrations ran is not supported: restore the backup
taken before the upgrade instead.

## Upgrading to 0.4

0.4 hardens sign-in. Before you change `INKADRA_TAG`:
1. **Pass the new settings to the container.** The `compose.yaml` on `main` forwards
   `OIDC_ALLOWED_DOMAINS`, `CSP_ENFORCE` and `HSTS_ENABLED` from `.env`. The
   files attached to the 0.4.0 release do not: if you use them and want any of these, add them
   under `environment` of the `inkadra` service, for example `HSTS_ENABLED: ${HSTS_ENABLED:-false}`.
   `CSP_REPORT_URI` is not forwarded by default, because 0.4.0 refuses an empty value: add
   `CSP_REPORT_URI: ${CSP_REPORT_URI}` only together with a value in `.env`.
2. **`REDIS_URL` is now required in production by every role, `web` included.** Sign-in limits
   are kept in Valkey. The bundled `compose.yaml` already sets it; if you run the `web` role on
   its own or with your own environment, point it at your Valkey or Redis, or it will not start.
3. **Google with `GOOGLE_ALLOWED_DOMAINS`** now checks the account's Workspace domain (`hd`) on
   every sign-in, also for accounts linked before. Personal Google accounts (`@gmail.com`) of
   people in that list can no longer sign in with Google: they use their password or an email
   link, or you remove the restriction.
4. **OIDC with `OIDC_ALLOWED_DOMAINS`** accepts only addresses the provider marks as verified
   (`email_verified`). Check that your provider sends that claim before setting it.
5. **Two-factor applies to every sign-in method**: people with an authenticator app are now asked
   for the code after an email link, Google or OIDC as well.
6. **Personal tokens** made without an expiry now last 90 days, and making one needs a recent
   sign-in (15 minutes). Tokens made before the upgrade keep their expiry.

Then upgrade as usual. If someone gets locked out by the new limits, clear them with
`unlock-auth` (see [Unlocking an account](configuration.md#unlocking-an-account)):

```sh
docker compose exec inkadra node /app/dist/main.js unlock-auth person@example.com
```

### Trying CSP enforcement

0.4 sends a `Content-Security-Policy` in **report-only** mode: the browser applies nothing, it
only reports what the policy would block. To switch to enforcement:
1. Use Inkadra normally for a while with the browser's developer tools open (Console): open
   boards with images, videos, YouTube links and files, sign in with each method you use. Every
   `[Report Only] Refused to load…` message is something enforcement would break. For a whole
   team, set `CSP_REPORT_URI` to an endpoint that collects reports.
2. Fix what you can at the source: a proxy that injects scripts or styles, an S3 address that
   differs from `S3_ENDPOINT`. If something Inkadra itself needs is blocked, please open an issue.
3. Set `CSP_ENFORCE=true` in `.env` and run `docker compose up -d`. If something breaks, set it
   back to `false`: nothing is stored, the header changes on the next page load.

### HSTS

HSTS is off in Inkadra by default; set it at the proxy (see
[Security headers](reverse-proxy.md#security-headers)) or with `HSTS_ENABLED=true`. Turn it on
only when HTTPS works for good: browsers remember it for a year.

## Upgrading to Valkey 9

`compose.yaml` now runs Valkey 9 instead of 8. Valkey 9 reads the data written by 8, but 8
cannot read data written by 9, so the step is one-way: back up the `valkey-data` volume (or
your `VALKEY_DATA` folder) before upgrading, and there is no downgrade. If the volume is lost,
the queues are rebuilt when the server starts; only jobs that were waiting to run are lost.

## Data folder owner

Inkadra runs as uid 1000. Versions after 0.1 write to `/data` as soon as they start, so a host
folder in `INKADRA_DATA` that belongs to another user, for example one created with `mkdir` as
root, stops them with "cannot write to /data".

The `compose.yaml` of the release handles this by itself: the container starts as root, gives
the folder to uid 1000 if the folder or one of its entries belongs to someone else, and then
runs as uid 1000 with no capabilities. The change of owner happens once, on the first start
that needs it. Take the new `compose.yaml` (it adds `user` and `cap_add` to the `inkadra`
service) and run `docker compose up -d`.

If you keep an older `compose.yaml`, or run the container as uid 1000 on purpose, give the
folder to uid 1000 yourself before upgrading:

```sh
sudo chown -R 1000:1000 /path/to/inkadra/data
```

## Verifying the image

Every published image comes with a signed build provenance attestation, made by GitHub Actions
in this repository, and a software bill of materials. To check that an image was built from this
repository by its CI and nothing else:

```sh
gh attestation verify oci://ghcr.io/inkadra/inkadra:0.4.0 --repo inkadra/inkadra
```

To list the packages inside it:

```sh
docker buildx imagetools inspect ghcr.io/inkadra/inkadra:0.4.0 --format '{{ json .SBOM }}'
```

## How releases are made

Every push to `main` publishes `edge` and `sha-<commit>`. For a release, a maintainer runs the
Release workflow, which tags `vX.Y.Z` on `main`, opens the GitHub release and starts CI on the
tag. CI runs in full (tests, end-to-end, the reverse proxy examples, a vulnerability scan of
the image), builds amd64 and arm64 on native runners without build cache, publishes `X.Y.Z`,
`X.Y` and `latest`, and attaches the deployment files to the release. Versions with a suffix
(`0.3.0-rc.1`) are pre-releases: they never move `latest` or `X.Y`.

## Upgrading to 0.4.2

Public `GET /api/v1/health` and `GET /api/v1/instance` responses no longer include `version`.
This deliberate security change removes a v1 response field: monitoring and discovery
clients must tolerate its absence. Signed-in clients can read `GET /api/v1/instance/version`;
administrator diagnostics retain their version. Refresh cached web clients after the upgrade.
See the [0.4.2 upgrade notes](../releases/0.4.2.md), including the one-time HTTPS sign-in and
extra 2FA prompt, legacy session-list entries, and coordinated updates of split roles.

The administrator two-step requirement defaults off for existing installations. Only an
administrator with verified 2FA can enable it. Keep recovery codes and access to the host-only
`inkadra admin-2fa off` emergency command before activation. Deploy the auth enforcement
and setting contract together for 0.4.2; do not activate the setting on an older auth server.
