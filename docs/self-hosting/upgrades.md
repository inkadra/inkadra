# Upgrades

Inkadra follows [semantic versioning](https://semver.org). Before 1.0, a minor version (0.2 →
0.3) can change things you need to act on; the release notes say what. From 1.0 on, only a
major version does.

## Updating

Pin a version in `.env`, so an upgrade happens when you decide:

```sh
INKADRA_TAG=0.9.0
```

To move to a new version, read its [release notes](https://github.com/inkadra/inkadra/releases),
back up (see [Backups](README.md#backups): `docker compose exec -u node inkadra node
/app/dist/main.js backup create`, plus a copy of the data volume or the bucket), change
`INKADRA_TAG` and run

```sh
docker compose pull
docker compose up -d --wait
```

Database migrations run when the new version starts, before it accepts requests, right after
an automatic [backup of the database](#the-backup-before-an-upgrade). Compare your
`compose.yaml` and `deploy/` files with the ones attached to the release: new settings arrive
there.

Migrations only go forward. To go back, follow
[Going back to an older version](#going-back-to-an-older-version). A backup restores on the same
or any newer version, so it also carries data across an upgrade.

### The backup before an upgrade

When a new version starts and finds migrations to apply on a database that has data, it first
writes a backup of the database, before changing anything: the usual archive
(`/data/backups/inkadra-backup-pre-upgrade-m<migrations>-<time>.zip`, copied to the bucket with
S3 storage), read back to check every table, with a small sample of files looked up in
storage. Settings → Backups lists it as "Before upgrade". The two newest of these are kept
apart from the nightly retention. A fresh install, and a restart with nothing to migrate, take
none. It holds the database only: the files stay in the data volume or the bucket, which
migrations do not touch. It works from any release an upgrade may start from (0.6 and later).

The backup takes about as long as `backup create` and needs free space in `/data/backups`;
the server refuses to start when the disk has clearly too little (about half the size of the
live table data). If the backup fails, **nothing is migrated** and the server stops with the
reason in the log: the database is as the previous version left it, so you can start that
version again or fix the cause (free space, folder permissions) and retry. To upgrade without
it, for example when you took a backup or a snapshot yourself, set
`SKIP_PRE_MIGRATION_BACKUP=true` in `.env` for that start.

If a **migration** fails after the backup, the server stops with the migration's error and
writes no second copy at the next starts: a start within 30 minutes reuses the archive of the
same database state, and a later one replaces it, so a restart loop never fills the disk. The
log of each start has the migration error. If you went back to the older version and used it
in between, retry after 30 minutes, or remove that archive first, so the backup holds what you
did since. Archives the history does not list (those of failed starts, or still on disk after
you [went back](#going-back-to-an-older-version) and restored) are listed at the next upgrade
that migrates, and the retention above then removes the older ones; until then remove them by
hand from `/data/backups` when you no longer need them.

**How long the start takes.** During the backup and the migrations the web role answers
`/livez` (so Docker's health check passes) but `/readyz`, `/api/v1/health` and every page
answer `503`: the container is alive, not ready, and the proxy shows an error page meanwhile.
On a large database, give `docker compose up -d --wait` enough time:
`--wait-timeout 3600`, or follow it with `docker compose logs -f inkadra`.

**Split mode and custom setups.** `collab` and `worker` wait until the web role has applied
the migrations before they start working (their health checks pass meanwhile). To keep the
wait out of `up`, run the migrations first, then start everything:

```sh
docker compose -f compose.yaml -f deploy/compose.split.yaml run --rm inkadra migrate
docker compose -f compose.yaml -f deploy/compose.split.yaml up -d --wait
```

In setups that start roles without `depends_on` (other orchestrators, hand-made services),
stop the old version's `worker` and `collab` before starting the new version: while the backup
runs they would keep writing to the database, and what they write after the backup is not in it.

### Going back to an older version

There are no down migrations: going back means the [backup taken before the
upgrade](#the-backup-before-an-upgrade) (`inkadra-backup-pre-upgrade-….zip`, the newest one,
or one you took yourself), restored with the older version, into a new, empty database.
Everything written after that backup is lost, so decide quickly, and keep the upgraded database
until you are sure.

```sh
docker compose stop inkadra
# Keep the upgraded database aside, renamed, until you no longer need it.
docker compose exec postgres psql -U inkadra -d postgres -c 'alter database inkadra rename to inkadra_upgraded'
docker compose exec postgres createdb -U inkadra inkadra
# INKADRA_TAG back to the older version in .env, then:
# The backup the upgrade wrote, newest last:
docker compose run --rm --entrypoint ls inkadra /data/backups
docker compose run --rm inkadra backup restore /data/backups/inkadra-backup-pre-upgrade-m<migrations>-<time>.zip
docker compose up -d --wait
```

The files stay where they are: files uploaded after the backup are kept in storage but no
longer listed. CI runs this rollback with the backup the upgrade wrote, and the upgrade from
the last release with its sample data, on every change (`scripts/test-release-upgrade.sh`).

From the version after 0.9.0, a server refuses to start on a database that a newer version
migrated, with a message that points here, instead of running on a schema it does not know.
Boards follow the same rule: a server opens only documents of its own schema or older (a
newer document can only come from a newer server, whose database it refuses), a backup or a
project archive from a newer version is refused, and older apps and browser tabs connected
to a newer server stay read-only on boards they would damage
([decision 0102](../decisions/0102-min-writer-schema.md)).

The sections below list what to do for each version, newest first. Read every one between
your version and the new one. 0.6 and 0.8 need nothing beyond the usual update.

## After 0.9.0 (current main)

These changes are on `main`, not in 0.9.0.

- **A database backup before migrations.** The first start of these builds on a 0.9.0
  database writes `inkadra-backup-pre-upgrade-….zip` before migrating, and refuses to migrate
  if it fails: check the free space in `/data/backups` first. See
  [The backup before an upgrade](#the-backup-before-an-upgrade).
- **Media tools are now in the standard image.** Remove `-media` from `INKADRA_TAG` when
  moving to these builds, not when installing 0.9.0. Standard still excludes LibreOffice.
- **Video copies use quality presets and multiple resolutions.** Review
  [Settings → Video](configuration.md#media-previews). Existing copies remain playable;
  regeneration is explicit. The default source-size limit is now unlimited, while the
  two-hour duration limit remains.
- **Modules are personal settings.** Storyboard, Production, Moodboard, Client review and
  Set plan can be switched off in Settings → Modules. This hides creation tools, not existing
  data. There is no server environment variable for modules.

- **Shooting days move to a Production board.** The schedule becomes the project's
  ([decision 0123](../decisions/0123-production-board.md)): when the new version starts, every
  project (archived ones included) whose boards have shooting days, or whose Troupe has people,
  gets a board called "Production" (in its creator's language) at the end of its root board, and
  the days of its boards move there, as they are. Days on boards in the trash stay where they
  are. A project that already has a Production board, even one in the trash, is left alone.
  It is one query, then one short transaction per project; a project that fails is logged
  ("Production board not made") and tried again at the next start.
  With a live Production board, new days belong there; without one, the old board schedule
  remains available.
- **Back up first,** as for any release with migrations. The way back for the instance is that
  backup, restored with the older version.
- **To hold the move back,** set `PRODUCTION_BOARD_MOVE=false` in `.env` before upgrading: the
  server starts without moving anything, and the next start with `true` (the default) does it.
  Only `true` and `false` are accepted: any other value stops the server at start. Importing a
  project archive of format 1 with days still makes its Production board, also with the move off.
- **Putting one project back by hand.** Days keep the board they came from in `moved_from`, so
  with the project's id as `$1`, this statement puts them back in a form the older version
  accepts (a scene block becomes a note with the scene's label):

  ```sql
  update shooting_day
  set board_id = moved_from, moved_from = null,
      blocks = (select coalesce(jsonb_agg(
                  (case when b.v ->> 'type' = 'scene'
                     then b.v || jsonb_build_object('type', 'note', 'title',
                       coalesce(nullif(b.v ->> 'title', ''), 'Scene ' || coalesce(b.v ->> 'sceneLabel', '')))
                     else b.v end)
                  - 'shotBoardId' - 'shotLabel' - 'sceneId' - 'sceneBoardId' - 'sceneLabel'
                  order by b.i), '[]')
                from jsonb_array_elements(blocks) with ordinality as b(v, i))
  where project_id = $1 and moved_from is not null;
  ```

  then move the project's Production board to the trash:

  ```sql
  update board set deleted_at = now()
  where project_id = $1 and kind = 'production' and deleted_at is null;
  ```

  Days created on the Production board after the move stay on it, in the trash with the board.

### Safer defaults in the deployment files

Take the new `compose.yaml` and `deploy/` files with this version (see [Updating](#updating)).
Your current `.env` keeps working; what changes, and what to do:

- **The Content-Security-Policy is enforced.** Until now the browser only reported what the
  policy would block. If your proxy injects scripts or styles, or files in S3 come from an
  address other than `S3_ENDPOINT`, something can stop loading (the browser's console says
  `Refused to load…`): set `CSP_ENFORCE=false` in `.env` and run `docker compose up -d`, then
  see [Trying CSP enforcement](#trying-csp-enforcement). An existing `CSP_ENFORCE=false` stays.
- **HSTS is on** when `PUBLIC_URL` is https: Inkadra sends `Strict-Transport-Security` on
  requests that reach it over HTTPS (through a proxy that `TRUST_PROXY` accepts), never on plain
  HTTP, so LAN and Tailscale addresses over HTTP keep working. If you also use plain HTTP on the
  **same host name** as `PUBLIC_URL`, set `HSTS_ENABLED=false` before upgrading: browsers keep
  HSTS for a year. An existing `HSTS_ENABLED=false` stays.
- **Postgres and Valkey are on their own network**, `backend`, which has no way out and which
  only Inkadra joins: the bundled proxies and anything else you put on the stack's `default`
  network can no longer reach them. A container of your own that talks to the database (a
  backup job, for example) must join `backend` too. `docker compose up -d` creates the network
  and recreates the three containers; data stays in its volumes.
- **Valkey can ask for a password.** New `.env` files have `VALKEY_PASSWORD`; without it Valkey
  starts without one, as before. To turn it on, add `VALKEY_PASSWORD=` with a value from
  `openssl rand -hex 32` (letters and digits only, it is part of a URL) and run
  `docker compose up -d`: Inkadra and Valkey restart with it. Jobs that were queued stay.
- **The bundled proxies are the only peer Inkadra trusts for client addresses.** Caddy, Nginx
  and Traefik in `deploy/proxy` now run at a fixed address, `10.212.47.2`, on a fixed subnet
  `10.212.47.0/24` of the stack's network, and set `TRUST_PROXY` to that address unless `.env`
  sets one. If your `.env` has a `TRUST_PROXY` line written for a bundled proxy, remove it or
  change it to `10.212.47.2`: with the old address Inkadra no longer trusts the proxy, sees
  every request as plain HTTP from one client and sends no HSTS. Compose recreates the network on `up -d`; if your version of Compose asks for it,
  run `docker compose down` (without `-v`) first. If the subnet is taken on your machine, choose
  another one in the proxy's compose file. Without a bundled proxy nothing changes, but set
  `TRUST_PROXY` to your proxy's address (see [TRUST_PROXY](configuration.md#trust_proxy)).
- **The bundled Traefik no longer reads the Docker socket.** Its routes come from a file
  defined in `deploy/proxy/traefik/compose.yaml` (and `compose.split.yaml`), with the same rules
  as the old labels; labels you added to `inkadra` for it are ignored. The read timeout of the
  HTTPS entry point is now 12 hours instead of none: uploads are in pieces of at most 50 MiB,
  but a project import is one request and must arrive within that time.

## Upgrading to 0.9

- **Reports go to the Inkadra developers by default,** also on an instance where they were off, unless
  an administrator saved a choice. Nothing leaves until someone writes a report, sees its preview and
  sends it. To avoid it, set an empty `FEEDBACK_RELAY_URL=` in `.env` **before** upgrading, then save a
  choice in **Settings → Reports**. See
  [What leaves your server](README.md#what-leaves-your-server).
- **Emails can switch to English.** People who never opened the language setting get them in English
  until they come back to the app, also on accounts that got Italian emails until now.
- **Board and project templates are gone.** Existing projects and boards stay as they are.
- Board documents move to a newer version. Tabs and installed apps from before the upgrade stay
  read-only and show an update notice until they reload: nothing they hold can overwrite the new fields.

## Upgrading to PostgreSQL 18

Since 0.7, `compose.yaml` runs PostgreSQL 18 instead of 16. A PostgreSQL server cannot read
the data folder of another major version, and the official image of 18 keeps its data in a different
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
database, and you need room for the dump and for the second copy of the database. Keep the SQL dump private: it contains account credentials
and tokens.

There are two ways. Both are run by CI on every change (`scripts/test-postgres-upgrade.sh`,
from seeded data on 16 to the app running on 18), so the commands below are the tested ones.

| Way                                      | Good for                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [Dump and restore](#dump-and-restore)    | The default. Uses a new volume and preserves the old database         |
| [In place](#in-place-with-pgautoupgrade) | A large database, where a dump takes too long. Changes the old volume |

You need Docker Compose 2.24.4 or newer for the files in `deploy/` (`docker compose version`).
Check which PostgreSQL you run now with
`docker compose exec postgres postgres --version`. The commands assume the project name
`inkadra` (the folder name, unless you set `-p`): replace `inkadra_postgres-data` with
`<project>_postgres-data` otherwise. `docker volume ls` shows it.

For split installs, include the same `-f` files in each command below and stop all three
application services (`inkadra`, `collab`, `worker`) wherever a step stops Inkadra. Do not
leave a worker writing to the database during a dump or restore.

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
   docker compose pull
   docker compose up -d --wait
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

**PostgreSQL 16.16 needs dump and restore with the tested image.** CI pins PostgreSQL
16.15 and `pgautoupgrade/pgautoupgrade:18.6-alpine` because that upgrader cannot read
the new column option written by 16.16: it stops at "Restoring database schemas in the new cluster", and its
`pg_upgrade_dump_*.log` says `unrecognized parameter "pg_attver"`. If
`docker compose exec postgres postgres --version` says 16.16 or newer, take the
[dump and restore](#dump-and-restore) unless you have verified an upgrader with PostgreSQL 18.7 or newer
(`docker run --rm --entrypoint postgres pgautoupgrade/pgautoupgrade:18-alpine --version`). If an
upgrade already stopped there, the volume is no longer usable as it is: empty it and unpack
`postgres-data-16.tgz` from step 1 into it, as in [Going back](#going-back). 16.15 and older
upgrade as below.

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
     -v inkadra_postgres-data:/var/lib/postgresql/data pgautoupgrade/pgautoupgrade:18.6-alpine
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

- Nightly backups are on by default at 03:00 server time, keeping the last 7 successful backups, in `/data/backups`.
  Make sure the data volume has room for them, or turn them off in **Settings → Backups** if
  you back up Postgres another way.
- Project export and import arrive. An import sends the whole archive in one request, up to
  `IMPORT_MAX_SIZE` (default 20GB): raise the body limit of your reverse proxy if it has one
  (see [Reverse proxy](reverse-proxy.md)).

## Upgrading to 0.4.2

- **The health check no longer says the version.** Public `GET /api/v1/health` and
  `GET /api/v1/instance` responses drop the `version` field, for security. Monitoring that reads
  it must cope without it; signed-in clients can read `GET /api/v1/instance/version`, and
  administrator diagnostics still show it. Reload open web clients after the upgrade.
- **"Require two-factor for administrators"** is a new setting, off on existing installations.
  Only an administrator with verified two-factor can turn it on. Before you do, keep the recovery
  codes and the emergency command that turns it off from the server
  ([details](sign-in.md#administrator-enrollment-policy)):

  ```sh
  docker compose exec inkadra node /app/dist/main.js admin-2fa off
  ```

  In split mode, upgrade every role together before turning it on.
- The [0.4.2 upgrade notes](../releases/0.4.2.md) cover the rest: the one-time HTTPS sign-in and
  extra two-factor prompt, old entries in the session list, and updating split roles together.

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

0.4 to 0.9 send the policy in report-only mode by default; 0.10 enforces it. To try enforcement
on an older version, or after turning it off, start with `CSP_ENFORCE=false` (report-only). Use
each sign-in method and board media type, and check the browser console for
`[Report Only] Refused to load…`. Fix blocked sources before setting `CSP_ENFORCE=true` and
recreating the container. Revert to `false` if needed. For a reporting endpoint, use
`CSP_REPORT_URI` as described in
[Browser security headers](configuration.md#browser-security-headers).

### HSTS

In 0.4 to 0.9 HSTS is off in Inkadra by default; set it at the proxy (see
[Security headers](reverse-proxy.md#security-headers)) or with `HSTS_ENABLED=true`. Turn it on
only when HTTPS works for good: browsers remember it for a year. From 0.10 it is on by default
(see [Safer defaults](#safer-defaults-in-the-deployment-files)).

## Upgrading to Valkey 9

Since 0.3, `compose.yaml` runs Valkey 9 instead of 8. Valkey 9 reads the data written by 8,
but 8 cannot read data written by 9, so the step is one-way: back up the `valkey-data` volume (or
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
gh attestation verify oci://ghcr.io/inkadra/inkadra:0.9.0 --repo inkadra/inkadra
```

To list the packages inside it:

```sh
docker buildx imagetools inspect ghcr.io/inkadra/inkadra:0.9.0 --format '{{ json .SBOM }}'
```

## How releases are made

Every push to `main` publishes `edge` and `sha-<commit>`. For a release, a maintainer runs the
Release workflow, which checks that CI passed on that commit of `main`, tags `vX.Y.Z`, opens
the GitHub release as a draft and starts CI on the tag. CI runs in full (tests, end-to-end, the
reverse proxy examples, a vulnerability scan of the image), builds amd64 and arm64, standard and
office, on native runners without build cache, starts and scans each of those images before
tagging them, publishes `X.Y.Z`, `X.Y` and `latest`, attaches the deployment files to the
release and only then publishes it, so the Updates page never offers a version without an image.
The deployment files pin `INKADRA_TAG` to that version. Versions with a suffix
(`0.3.0-rc.1`) are pre-releases: they never move `latest` or `X.Y`.

What each release candidate must pass before the release, automated or by hand, is in the
[release checklist](../releases/CHECKLIST.md).

Tell us how your upgrade went and
what was unclear in this guide in [GitHub Discussions](https://github.com/inkadra/inkadra/discussions)
or an [issue](https://github.com/inkadra/inkadra/issues/new/choose).
