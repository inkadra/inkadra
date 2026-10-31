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
back up (see [Backups](README.md#backups): `docker compose exec -u node inkadra node
/app/dist/main.js backup create`, plus a copy of the data volume or the bucket), change
`INKADRA_TAG` and run

```sh
docker compose pull
docker compose up -d
```

Database migrations run when the new version starts, before it accepts requests. Compare your
`compose.yaml` and `deploy/` files with the ones attached to the release: new settings arrive
there.

Going back to an older version after its migrations ran is not supported: restore the backup
taken before the upgrade instead, with that older version
(see [Restoring](README.md#restoring)). A backup restores on the same or any newer version, so it
also carries data across an upgrade.

## Upgrading to PostgreSQL 18

`compose.yaml` now runs PostgreSQL 18 instead of 16. A PostgreSQL server cannot read the data
folder of another major version, and the official image of 18 keeps its data in a different
place (`/var/lib/postgresql/18/docker`, the volume being `/var/lib/postgresql`). So an existing
install has to move its database once. Nothing else changes: Inkadra runs on PostgreSQL 16 and
newer, and **16 stays supported for one more release** (see
[Staying on PostgreSQL 16](#staying-on-postgresql-16-for-now)).

Do the steps in this order. Do **not** just replace `compose.yaml` and run `docker compose up -d`:
PostgreSQL 18 cannot use the `postgres-data` volume (or `POSTGRES_DATA` folder) of 16. It does
not start an empty database beside your data: it stops, and its log says "The volume holds a
PostgreSQL 16 database from an older layout" with a link to this section. Nothing is lost, but
the instance is down until you do the steps below. It takes a
few minutes of downtime for a small instance; the dump and restore grow with the size of the
database, and you need room for the dump and for the second copy of the database.

There are two ways. Both are run by CI on every change (`scripts/test-postgres-upgrade.sh`,
from seeded data on 16 to the app running on 18), so the commands below are the tested ones.

| Way                                      | Good for                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| [Dump and restore](#dump-and-restore)    | The default. A new volume: the old one stays as it was, so going back is easy |
| [In place](#in-place-with-pgautoupgrade) | A large database, where a dump takes too long. Changes the old volume         |

You need Docker Compose 2.24 or newer for the files in `deploy/` (`docker compose version`).
Check which PostgreSQL you run now with
`docker compose exec postgres postgres --version`. The commands assume the project name
`inkadra` (the folder name, unless you set `-p`): replace `inkadra_postgres-data` with
`<project>_postgres-data` otherwise. `docker volume ls` shows it.

### Back up first

Whichever way you take, start with the backups, from the `compose.yaml` you run today:

```sh
docker compose exec -u node inkadra node /app/dist/main.js backup create
docker compose cp inkadra:/data/backups ./inkadra-backups     # keep a copy off the volume
```

The first is the Inkadra backup (see [Backups](README.md#backups)): it restores into an empty
database of any PostgreSQL version, so it is also your way back. Files are not part of it: keep
your usual copy of the data volume or the bucket. Check that `./inkadra-backups` holds a recent
`inkadra-backup-….zip`.

### Dump and restore

1. **Stop Inkadra, so nothing writes, and dump the database** with the server that holds it.
   Check the end of the file: it must say the dump is complete.

   ```sh
   docker compose stop inkadra
   docker compose exec -T postgres pg_dump -U inkadra --no-owner inkadra > inkadra.sql
   tail -n 5 inkadra.sql | grep "dump complete"
   ```

   The bundled database holds only `inkadra`. If you added other databases or roles to it, use
   `pg_dumpall -U inkadra > all.sql` and restore that instead, into a new cluster, expecting
   "already exists" messages for the `inkadra` role and database.

2. **Stop the old database.** The volumes stay: never add `-v`.

   ```sh
   docker compose down
   ```

3. **Take the new files.** Replace `compose.yaml` and the files of `deploy/` you use with the
   ones of the release, and merge new settings of `.env.example` into `.env`. With a host folder
   in `POSTGRES_DATA`, pick a **new, empty folder** for PostgreSQL 18, owned by uid 70
   (see [Storage](storage.md)), and keep the old one:

   ```sh
   mkdir -p /srv/inkadra/postgres18
   chown 70:70 /srv/inkadra/postgres18
   # .env: POSTGRES_DATA=/srv/inkadra/postgres18
   ```

   With the default volume, use the second one `compose.yaml` declares, so that `postgres-data`
   stays as it is:

   ```sh
   # .env: POSTGRES_DATA=postgres18-data
   ```

4. **Start PostgreSQL 18 alone and load the dump.**

   ```sh
   docker compose up -d --wait postgres
   docker compose exec postgres postgres --version         # 18.x
   docker compose exec -T postgres psql -U inkadra -d inkadra -v ON_ERROR_STOP=1 --single-transaction -q < inkadra.sql
   ```

   The load is one transaction: if it fails, nothing is half loaded. Fix the cause and run it
   again (if the database already has tables, empty it first: `docker compose exec postgres
   dropdb -U inkadra inkadra && docker compose exec postgres createdb -U inkadra inkadra`).

5. **Start everything.** Pull the new image first if you are also moving to a newer Inkadra:
   its migrations run on start, before it accepts requests.

   ```sh
   docker compose up -d
   docker compose ps          # inkadra, postgres and valkey "healthy"
   ```

   Sign in and look at a project. Statistics for the planner are rebuilt by autovacuum within a
   few minutes; on a large database run `docker compose exec postgres vacuumdb -U inkadra
   --analyze-only inkadra` to hurry it.

6. **Keep the old data for a while.** The volume `postgres-data` (or the old folder) is the way
   back, untouched. Delete it once you are sure, after a week of normal use, for example:
   `docker volume rm inkadra_postgres-data`. Keep `POSTGRES_DATA` in `.env`: new installs use
   `postgres-data` for the cluster of 18 (it is where `18/docker` lives), yours uses
   `postgres18-data`.

### In place with pgautoupgrade

[pgautoupgrade](https://github.com/pgautoupgrade/docker-pgautoupgrade) upgrades a data folder
with `pg_upgrade`, which is faster than a dump on large databases. It **changes the old volume**,
and a half-done upgrade cannot be undone from inside it, so copy the volume first. The data
stays in the layout of 16 (`/var/lib/postgresql/data`): you keep adding
`deploy/compose.postgres-old-layout.yaml`, with `POSTGRES_MAJOR=18`, and can move to the new
layout later with a dump and restore.

1. **Stop everything and copy the volume.** For a host folder, copy the folder instead
   (`cp -a`, keeping owners).

   ```sh
   docker compose stop inkadra
   docker compose down
   docker run --rm -v inkadra_postgres-data:/from -v "$PWD":/to alpine \
     tar czf /to/postgres-data-16.tgz -C /from .
   ```

2. **Take the new `compose.yaml` and `deploy/` files** as in step 3 above, but leave
   `POSTGRES_DATA` as it was, and tell Compose to use the old-layout file every time:

   ```sh
   cat >> .env <<'ENV'
   COMPOSE_FILE=compose.yaml:deploy/compose.postgres-old-layout.yaml
   POSTGRES_MAJOR=18
   ENV
   ```

   Add your other files to `COMPOSE_FILE` too (separated by `:`), for example
   `deploy/compose.s3.yaml`.

3. **Upgrade the volume.** The password is not used, the database exists already; the image
   only insists on one. The container exits when it is done. For a host folder, give it as
   `-v /srv/inkadra/postgres:/var/lib/postgresql/data`.

   ```sh
   docker run --rm -e POSTGRES_USER=inkadra -e POSTGRES_DB=inkadra -e POSTGRES_PASSWORD=unused \
     -e PGDATA=/var/lib/postgresql/data -e PGAUTO_ONESHOT=yes \
     -v inkadra_postgres-data:/var/lib/postgresql/data pgautoupgrade/pgautoupgrade:18-alpine
   ```

4. **Start.**

   ```sh
   docker compose up -d --wait postgres
   docker compose exec postgres postgres --version          # 18.x
   docker compose up -d
   ```

### Staying on PostgreSQL 16 for now

Keep the volume you have and add the old-layout file to every command (or to `COMPOSE_FILE` in
`.env`, as above): it runs `postgres:16-alpine` on `postgres-data` (or your `POSTGRES_DATA`).

```sh
docker compose -f compose.yaml -f deploy/compose.postgres-old-layout.yaml up -d
```

PostgreSQL 16 stays supported, and CI keeps running the server tests against it, for one more
release. After that the file is removed: move to 18 before then.

### Going back

Before you delete the old volume you can return to PostgreSQL 16 in two ways.

**To the database as it was before the upgrade** (after a dump and restore; whatever was
written on 18 since is lost). Point `POSTGRES_DATA` back at the old volume or folder: delete the
line `POSTGRES_DATA=postgres18-data` from `.env`, or set the old folder again.

```sh
docker compose down
docker compose -f compose.yaml -f deploy/compose.postgres-old-layout.yaml up -d
```

**With what was written since**, from an Inkadra backup made on 18, into a new, empty database
of 16:

```sh
docker compose exec -u node inkadra node /app/dist/main.js backup create
docker compose down
mkdir -p /srv/inkadra/postgres16-new && chown 70:70 /srv/inkadra/postgres16-new
export POSTGRES_DATA=/srv/inkadra/postgres16-new      # instead of the line in .env
docker compose -f compose.yaml -f deploy/compose.postgres-old-layout.yaml up -d --wait postgres
docker compose -f compose.yaml -f deploy/compose.postgres-old-layout.yaml run --rm inkadra backup restore /data/backups/inkadra-backup-<the newest>.zip
docker compose -f compose.yaml -f deploy/compose.postgres-old-layout.yaml up -d
```

After an in-place upgrade the second way works the same; the first is the copy of the volume you
made: stop everything, empty the volume and unpack `postgres-data-16.tgz` into it.

## Upgrading to 0.5

- Nightly backups are on by default at 03:00 server time, kept for 7 days, in `/data/backups`.
  Make sure the data volume has room for them, or turn them off in **Settings → Backups** if
  you back up Postgres another way.
- Project export and import arrive. An import sends the whole archive in one request, up to
  `IMPORT_MAX_SIZE` (default 20GB): raise the body limit of your reverse proxy if it has one
  (see [Reverse proxy](reverse-proxy.md)).

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
