#!/usr/bin/env bash
# Checks the move to PostgreSQL 19 that docs/self-hosting/upgrades.md describes, with the
# compose files of this repository: seed data through the app on the older PostgreSQL, back up,
# upgrade the database, and check that the app starts, applies its migrations and finds
# everything it had. Then the ways back: to a new database of the older version with the data
# written since (an Inkadra backup) and, after a dump and restore, to the old volume exactly as
# it was. The commands under "Upgrading to PostgreSQL 19" in the guide are the ones used here.
#
#   scripts/test-postgres-upgrade.sh [dump|in-place] [18|16]
#
# dump (default)  pg_dump, a new volume for PostgreSQL 19, restore
# in-place        pgautoupgrade on the volume of the older version
# 18 (default)    from PostgreSQL 18, as compose.yaml ran it up to 0.11 (deploy/compose.postgres18.yaml)
# 16              from PostgreSQL 16 on the old layout (deploy/compose.postgres-old-layout.yaml)
#
# Needs Docker with Compose 2.24 or newer, curl and openssl, and port 3000 free (INKADRA_PORT).
# The image is ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}; CI sets it to the
# image it built. INKADRA_FROM_TAG seeds the data with an older version of the app (0.5 or newer,
# which can make backups), to check that migrations apply during the upgrade; the default is the
# same image, with nothing to migrate.
set -euo pipefail

mode=${1:-dump}
from=${2:-18}
[[ ($mode == dump || $mode == in-place) && ($from == 18 || $from == 16) ]] || {
  echo "usage: test-postgres-upgrade.sh [dump|in-place] [18|16]" >&2
  exit 2
}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=inkadra-pg-upgrade-$mode-$from
port=${INKADRA_PORT:-3000}
url="http://localhost:$port"
image=${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}
tag=${INKADRA_TAG:-edge}
from_tag=${INKADRA_FROM_TAG:-$tag}
email=upgrade@example.com
# The upgrader of the guide, pinned like the images of compose.yaml.
pgautoupgrade=pgautoupgrade/pgautoupgrade:19.0-alpine@sha256:d61f2a51b403a913eaef42e23a90510f802b9ea4b53343463114e5959f88baad
password=correct-horse-battery

cat >"$work/.env" <<ENV
PUBLIC_URL=$url
INKADRA_PORT=$port
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
INKADRA_IMAGE=$image
INKADRA_TAG=$tag
ENV

compose() { INKADRA_ENV_FILE="$work/.env" docker compose --progress quiet -p "$project" --project-directory "$root" --env-file "$work/.env" "$@"; }
oldlayout() { compose -f "$root/compose.yaml" -f "$root/deploy/compose.postgres-old-layout.yaml" "$@"; }
# The stack as it was (the older PostgreSQL on the volume postgres-data) and as compose.yaml has
# it now. From 16, the in-place upgrade goes on in the old layout, with the same files and the
# new version; from 18 it lands in 19/docker, where compose.yaml looks.
if [[ $from == 16 ]]; then
  old() { POSTGRES_MAJOR=16 INKADRA_TAG=$from_tag oldlayout "$@"; }
  old_file=deploy/compose.postgres-old-layout.yaml
  refusal="The volume holds a PostgreSQL 16 database from an older layout"
else
  old() { INKADRA_TAG=$from_tag compose -f "$root/compose.yaml" -f "$root/deploy/compose.postgres18.yaml" "$@"; }
  old_file=deploy/compose.postgres18.yaml
  refusal="The volume holds a PostgreSQL 18 database, and this is PostgreSQL 19"
fi
new() { compose -f "$root/compose.yaml" "$@"; }
if [[ $mode == in-place && $from == 16 ]]; then
  now() { POSTGRES_MAJOR=19 oldlayout "$@"; }
else
  now() { new "$@"; }
fi
stack=old
sql() { "$stack" exec -T postgres psql -U inkadra -d inkadra -Atqc "$1"; }

failed=0
cleanup() {
  if [[ $failed != 0 ]]; then "$stack" logs --no-color --tail 60 || true; fi
  old down -v --remove-orphans >/dev/null 2>&1 || true
  new down -v --remove-orphans >/dev/null 2>&1 || true
  # Whatever volume a stack of this test still holds (which one depends on how far it got).
  docker volume ls -q --filter "label=com.docker.compose.project=$project" | xargs -r docker volume rm >/dev/null 2>&1 || true
  # Folders made by containers belong to other users.
  docker run --rm -v "$work:/w" --entrypoint sh postgres:$from-alpine -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

pass() { echo "  ok   $1"; }
fail() {
  echo "  FAIL $1"
  failed=1
}

c() { curl -s --max-time 30 -H "Origin: $url" -H 'Content-Type: application/json' "$@"; }
jar="$work/cookies"
sign_up() { c -o /dev/null -w '%{http_code}' -c "$jar" --data "{\"name\":\"Upgrade Test\",\"email\":\"$email\",\"password\":\"$password\"}" "$url/api/auth/sign-up/email"; }
sign_in() { c -o /dev/null -w '%{http_code}' -c "$jar" --data "{\"email\":\"$email\",\"password\":\"$password\"}" "$url/api/auth/sign-in/email"; }
projects() { c -b "$jar" "$url/api/v1/projects"; }
create_project() { c -b "$jar" --data "{\"name\":\"$1\"}" "$url/api/v1/projects"; }
version() { sql 'show server_version_num'; }
major() { echo $(($(version) / 10000)); }
migrations() { sql 'select count(*) from drizzle.__drizzle_migrations'; }
# The newest backup file in the data volume, by name (they carry their date).
newest_backup() { "$stack" exec -T inkadra sh -c 'ls /data/backups/inkadra-backup-*.zip | sort | tail -n1' | tr -d '\r'; }

echo "== PostgreSQL $from to 19 ($mode)"

# ---------------------------------------------------------------- before: the older version
stack=old
old up -d --quiet-pull --wait --wait-timeout 180
[[ $(major) == "$from" ]] && pass "starts on PostgreSQL $from ($old_file)" ||
  fail "expected PostgreSQL $from, got $(version)"

[[ $(sign_up) == 200 ]] && pass "first account created through the app" || fail "sign-up"
before=$(create_project "Before the upgrade")
project_id=$(sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' <<<"$before" | head -n1)
root_board=$(sed -n 's/.*"rootBoardId":"\([0-9a-f-]\{36\}\)".*/\1/p' <<<"$before")
board=$(c -b "$jar" --data "{\"parentBoardId\":\"$root_board\",\"title\":\"Moodboard before\"}" \
  "$url/api/v1/projects/$project_id/boards")
[[ -n $project_id && $board == *"Moodboard before"* ]] && pass "project and board created" ||
  fail "seeding (project: $before, board: $board)"
migrations_before=$(migrations)
users_before=$(sql 'select count(*) from "user"')

# ------------------------------------------------- the guide: back up, stop
# 1. An Inkadra backup (restores on any version, whatever the PostgreSQL behind it).
old exec -T -u node inkadra node /app/dist/main.js backup create >"$work/backup.log" 2>&1 &&
  [[ -n $(newest_backup) ]] && pass "Inkadra backup created" || fail "backup create: $(cat "$work/backup.log")"
# 2. Nothing writes while the database is dumped or upgraded.
old stop inkadra

if [[ $mode == dump ]]; then
  # --------------------------------------------- the guide: dump, new volume, restore
  # 3. The dump of the database, as the old server writes it.
  old exec -T postgres pg_dump -U inkadra --no-owner inkadra >"$work/inkadra.sql"
  [[ $(wc -c <"$work/inkadra.sql") -gt 10000 ]] && tail -n5 "$work/inkadra.sql" | grep -q 'PostgreSQL database dump complete' &&
    pass "database dumped ($(wc -c <"$work/inkadra.sql") bytes)" || fail "dump looks incomplete"
  # 4. Stop the old database. Volumes stay.
  old down

  # What a plain `docker compose pull && up -d` does on an existing install: the new
  # compose.yaml finds the cluster of the older version in postgres-data and stops, with the
  # pointer to the guide, instead of starting an empty database (and the app on it) beside the data.
  if new up -d --quiet-pull --wait --wait-timeout 45 >"$work/plain-up.log" 2>&1; then
    fail "plain up on the volume of PostgreSQL $from started"
  else
    plain_logs=$(new logs --no-color postgres 2>&1)
    if [[ $plain_logs == *"$refusal"* && $plain_logs == *"upgrades.md#upgrading-to-postgresql-19"* ]]; then
      pass "plain up on the volume of PostgreSQL $from stops with the guide message"
    else
      fail "plain up: wrong message: $(tail -n5 "$work/plain-up.log") / $(tail -n5 <<<"$plain_logs")"
    fi
  fi
  [[ -z $(new ps --status running --services | grep -x inkadra || true) ]] &&
    ! curl -sf --max-time 5 "$url/api/v1/health" >/dev/null &&
    pass "the app did not start on an empty database" || fail "the app is running after a plain up"
  [[ $(docker volume ls -q | grep -c "^${project}_postgres19-data$" || true) == 0 ]] &&
    pass "no new volume was filled" || fail "a new volume exists"
  [[ $(docker run --rm -v "${project}_postgres-data:/v:ro" --entrypoint sh postgres:$from-alpine -c 'ls /v') != *19* ]] &&
    pass "no cluster of 19 created beside the old one" || fail "a 19 folder appeared on the old volume"
  new down
  # Step 3 of the guide: the new database goes on a volume of its own.
  echo "POSTGRES_DATA=postgres19-data" >>"$work/.env"

  # The same refusal for a host folder.
  if [[ $from == 16 ]]; then
    mkdir "$work/old-layout"
    echo 16 >"$work/old-layout/PG_VERSION"
  else
    mkdir -p "$work/old-layout/18/docker"
    echo 18 >"$work/old-layout/18/docker/PG_VERSION"
  fi
  if out=$(POSTGRES_DATA="$work/old-layout" new run --rm --no-deps postgres 2>&1); then
    fail "PostgreSQL 19 started on a PostgreSQL $from folder"
  elif [[ $out == *"$refusal"* && $out == *"upgrades.md#upgrading-to-postgresql-19"* ]]; then
    pass "PostgreSQL 19 refuses a folder with a PostgreSQL $from cluster, and says what to do"
  else
    fail "wrong message on a PostgreSQL $from folder: $out"
  fi

  stack=new
  new up -d --quiet-pull --wait --wait-timeout 120 postgres
  [[ $(major) == 19 ]] && pass "PostgreSQL 19 started on a new volume" || fail "expected PostgreSQL 19, got $(version)"
  [[ $(sql "select count(*) from pg_tables where schemaname = 'public'") == 0 ]] && pass "new database is empty" ||
    fail "new database is not empty"
  new exec -T postgres psql -U inkadra -d inkadra -v ON_ERROR_STOP=1 --single-transaction -q <"$work/inkadra.sql" >"$work/restore.log" 2>&1 &&
    pass "dump restored" || fail "restore failed: $(tail -n5 "$work/restore.log")"
  [[ $(sql 'select count(*) from "user"') == "$users_before" ]] && pass "same number of accounts" || fail "accounts differ"
else
  # --------------------------------------------- the guide: pgautoupgrade, in place
  old down
  if [[ $from == 16 ]]; then
    upgrade_mount=(-e PGDATA=/var/lib/postgresql/data -v "${project}_postgres-data:/var/lib/postgresql/data")
  else
    upgrade_mount=(-v "${project}_postgres-data:/var/lib/postgresql")
  fi
  docker run --rm -e POSTGRES_PASSWORD=unused -e POSTGRES_USER=inkadra -e POSTGRES_DB=inkadra \
    -e PGAUTO_ONESHOT=yes "${upgrade_mount[@]}" \
    "$pgautoupgrade" >"$work/autoupgrade.log" 2>&1 &&
    pass "pgautoupgrade upgraded the volume" || {
    fail "pgautoupgrade: $(tail -n10 "$work/autoupgrade.log")"
    # pg_upgrade keeps its logs in the volume only when it fails: show their ends.
    docker run --rm -v "${project}_postgres-data:/d:ro" --entrypoint sh postgres:$from-alpine -c \
      'find /d -path "*pg_upgrade_output.d*" \( -name "*.log" -o -name "*.txt" \) | while read -r f; do echo "--- $f"; tail -n 30 "$f"; done' || true
  }
  stack=now
  now up -d --quiet-pull --wait --wait-timeout 120 postgres
  [[ $(major) == 19 ]] && pass "PostgreSQL 19 runs on the upgraded volume" || fail "expected PostgreSQL 19, got $(version)"
  [[ $(sql 'select count(*) from "user"') == "$users_before" ]] && pass "same number of accounts" || fail "accounts differ"
fi

now up -d --wait --wait-timeout 180
pass "app starts on PostgreSQL 19"
[[ $(migrations) -ge $migrations_before ]] && pass "all migrations applied ($migrations_before before, $(migrations) now)" ||
  fail "migrations: $migrations_before before, $(migrations) now"
[[ $(c "$url/api/v1/health") == *'"status":"ok"'* ]] && pass "health ok" || fail "health"

# The session cookie from before still works, and so does the password.
code=$(c -o /dev/null -w '%{http_code}' -b "$jar" "$url/api/v1/me")
[[ $code == 200 ]] && pass "session from before the upgrade still valid" || fail "session (got $code)"
[[ $(sign_in) == 200 ]] && pass "sign-in with the same password" || fail "sign-in"
[[ $(projects) == *"Before the upgrade"* ]] && pass "project is there" || fail "project missing"
[[ $(c -b "$jar" "$url/api/v1/projects/$project_id/boards") == *"Moodboard before"* ]] && pass "board is there" ||
  fail "board missing"

# --------------------------------------------------------- the guide: rollback
# Written on 19, to be kept in the first rollback.
create_project "After the upgrade" >/dev/null
[[ $(projects) == *"After the upgrade"* ]] || fail "second project not created"

# B. Back to the older version with what was written since: an Inkadra backup made on 19
# restores into an empty database of it (a logical backup does not care about the version).
now exec -T -u node inkadra node /app/dist/main.js backup create >"$work/backup19.log" 2>&1 || fail "backup on 19: $(cat "$work/backup19.log")"
backup_file=$(newest_backup)
now down
mkdir "$work/pg-rollback"
docker run --rm -v "$work/pg-rollback:/p" --entrypoint chown postgres:$from-alpine 70:70 /p
stack=old
from_tag=$tag # the application stays as it is: only the database goes back
export POSTGRES_DATA="$work/pg-rollback"
old up -d --quiet-pull --wait --wait-timeout 120 postgres
[[ $(major) == "$from" ]] && pass "rollback: new PostgreSQL $from database" || fail "rollback: expected PostgreSQL $from"
old run --rm inkadra backup restore "$backup_file" >"$work/restore-rollback.log" 2>&1 &&
  pass "rollback: backup made on 19 restored into $from" || fail "rollback restore: $(tail -n8 "$work/restore-rollback.log")"
old up -d --wait --wait-timeout 180
[[ $(sign_in) == 200 ]] && p=$(projects) || p=
[[ $p == *"Before the upgrade"* && $p == *"After the upgrade"* ]] && pass "rollback: both projects there, sign-in works" ||
  fail "rollback: projects after restore: $p"

# A. Back to the old volume exactly as it was before the upgrade. Only a dump and restore leaves
# it so; pgautoupgrade changed it, and there the way back is a copy of the volume.
if [[ $mode == dump ]]; then
  old down
  unset POSTGRES_DATA
  sed -i '/^POSTGRES_DATA=/d' "$work/.env"
  old up -d --wait --wait-timeout 180
  [[ $(sign_in) == 200 ]] && p=$(projects) || p=
  [[ $p == *"Before the upgrade"* && $p != *"After the upgrade"* ]] && pass "rollback: old volume untouched" ||
    fail "rollback: old volume has: $p"
fi

if [[ $failed != 0 ]]; then
  echo "== PostgreSQL $from to 19 ($mode): FAILED"
  exit 1
fi
echo "== PostgreSQL $from to 19 ($mode): passed"
