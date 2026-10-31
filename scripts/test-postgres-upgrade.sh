#!/usr/bin/env bash
# Checks the move from PostgreSQL 16 to 18 that docs/self-hosting/upgrades.md describes, with
# the compose files of this repository: seed data through the app on PostgreSQL 16, back up,
# upgrade the database, and check that the app starts, applies its migrations and finds
# everything it had. Then the ways back: to a new PostgreSQL 16 with the data written since (an
# Inkadra backup) and, after a dump and restore, to the old volume exactly as it was.
# The commands under "Upgrading to PostgreSQL 18" in the guide are the ones used here.
#
#   scripts/test-postgres-upgrade.sh [dump|in-place]
#
# dump (default)  pg_dump, a new volume for PostgreSQL 18, restore
# in-place        pgautoupgrade on the volume of PostgreSQL 16
#
# Needs Docker with Compose 2.24 or newer, curl and openssl, and port 3000 free (INKADRA_PORT).
# The image is ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}; CI sets it to the
# image it built. INKADRA_FROM_TAG seeds the data with an older version of the app (0.5 or newer,
# which can make backups), to check that migrations apply during the upgrade; the default is the
# same image, with nothing to migrate.
set -euo pipefail

mode=${1:-dump}
[[ $mode == dump || $mode == in-place ]] || {
  echo "usage: test-postgres-upgrade.sh [dump|in-place]" >&2
  exit 2
}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=inkadra-pg-upgrade-$mode
port=${INKADRA_PORT:-3000}
url="http://localhost:$port"
image=${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}
tag=${INKADRA_TAG:-edge}
from_tag=${INKADRA_FROM_TAG:-$tag}
email=upgrade@example.com
password=correct-horse-battery

cat >"$work/.env" <<ENV
PUBLIC_URL=$url
INKADRA_PORT=$port
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
INKADRA_IMAGE=$image
INKADRA_TAG=$tag
ENV

compose() { docker compose --progress quiet -p "$project" --project-directory "$root" --env-file "$work/.env" "$@"; }
# The stack as it was (PostgreSQL 16 on the volume postgres-data) and as compose.yaml has it now.
# The in-place upgrade goes on in the old layout, with the same files and the new version.
old() { INKADRA_TAG=$from_tag compose -f "$root/compose.yaml" -f "$root/deploy/compose.postgres-old-layout.yaml" "$@"; }
new() { compose -f "$root/compose.yaml" "$@"; }
if [[ $mode == dump ]]; then
  now() { new "$@"; }
else
  now() { POSTGRES_MAJOR=18 compose -f "$root/compose.yaml" -f "$root/deploy/compose.postgres-old-layout.yaml" "$@"; }
fi
stack=old
sql() { "$stack" exec -T postgres psql -U inkadra -d inkadra -Atqc "$1"; }

failed=0
cleanup() {
  if [[ $failed != 0 ]]; then "$stack" logs --no-color --tail 60 || true; fi
  old down -v --remove-orphans >/dev/null 2>&1 || true
  new down -v --remove-orphans >/dev/null 2>&1 || true
  # Folders made by containers belong to other users.
  docker run --rm -v "$work:/w" --entrypoint sh postgres:16-alpine -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
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
migrations() { sql 'select count(*) from drizzle.__drizzle_migrations'; }
# The newest backup file in the data volume, by name (they carry their date).
newest_backup() { "$stack" exec -T inkadra sh -c 'ls /data/backups/inkadra-backup-*.zip | sort | tail -n1' | tr -d '\r'; }

echo "== PostgreSQL 16 to 18 ($mode)"

# ---------------------------------------------------------------- before: PostgreSQL 16
stack=old
old up -d --quiet-pull --wait --wait-timeout 180
[[ $(version) -lt 170000 ]] && pass "starts on PostgreSQL 16 (deploy/compose.postgres-old-layout.yaml)" ||
  fail "expected PostgreSQL 16, got $(version)"

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

  # The new compose.yaml refuses a volume that holds a cluster from the old layout, instead of
  # starting an empty database beside it.
  mkdir "$work/old-layout"
  echo 16 >"$work/old-layout/PG_VERSION"
  if out=$(POSTGRES_DATA="$work/old-layout" new run --rm --no-deps postgres 2>&1); then
    fail "PostgreSQL 18 started on a PostgreSQL 16 folder"
  elif [[ $out == *"from an older layout"* && $out == *"upgrades.md#upgrading-to-postgresql-18"* ]]; then
    pass "PostgreSQL 18 refuses a folder with a PostgreSQL 16 cluster, and says what to do"
  else
    fail "wrong message on a PostgreSQL 16 folder: $out"
  fi

  stack=new
  new up -d --quiet-pull --wait --wait-timeout 120 postgres
  [[ $(version) -ge 180000 ]] && pass "PostgreSQL 18 started on a new volume" || fail "expected PostgreSQL 18, got $(version)"
  [[ $(sql "select count(*) from pg_tables where schemaname = 'public'") == 0 ]] && pass "new database is empty" ||
    fail "new database is not empty"
  new exec -T postgres psql -U inkadra -d inkadra -v ON_ERROR_STOP=1 --single-transaction -q <"$work/inkadra.sql" >"$work/restore.log" 2>&1 &&
    pass "dump restored" || fail "restore failed: $(tail -n5 "$work/restore.log")"
  [[ $(sql 'select count(*) from "user"') == "$users_before" ]] && pass "same number of accounts" || fail "accounts differ"
else
  # --------------------------------------------- the guide: pgautoupgrade, in place
  old down
  docker run --rm -e POSTGRES_PASSWORD=unused -e POSTGRES_USER=inkadra -e POSTGRES_DB=inkadra \
    -e PGDATA=/var/lib/postgresql/data -e PGAUTO_ONESHOT=yes \
    -v "${project}_postgres-data:/var/lib/postgresql/data" \
    pgautoupgrade/pgautoupgrade:18-alpine >"$work/autoupgrade.log" 2>&1 &&
    pass "pgautoupgrade upgraded the volume" || fail "pgautoupgrade: $(tail -n10 "$work/autoupgrade.log")"
  stack=now
  now up -d --quiet-pull --wait --wait-timeout 120 postgres
  [[ $(version) -ge 180000 ]] && pass "PostgreSQL 18 runs on the upgraded volume (POSTGRES_MAJOR=18)" ||
    fail "expected PostgreSQL 18, got $(version)"
  [[ $(sql 'select count(*) from "user"') == "$users_before" ]] && pass "same number of accounts" || fail "accounts differ"
fi

now up -d --wait --wait-timeout 180
pass "app starts on PostgreSQL 18"
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
# Written on 18, to be kept in the first rollback.
create_project "After the upgrade" >/dev/null
[[ $(projects) == *"After the upgrade"* ]] || fail "second project not created"

# B. Back to PostgreSQL 16 with what was written since: an Inkadra backup made on 18 restores
# into an empty database of 16 (a logical backup does not care about the PostgreSQL version).
now exec -T -u node inkadra node /app/dist/main.js backup create >"$work/backup18.log" 2>&1 || fail "backup on 18: $(cat "$work/backup18.log")"
backup_file=$(newest_backup)
now down
mkdir "$work/pg16-new"
docker run --rm -v "$work/pg16-new:/p" --entrypoint chown postgres:16-alpine 70:70 /p
stack=old
from_tag=$tag # the application stays as it is: only the database goes back
export POSTGRES_DATA="$work/pg16-new"
old up -d --quiet-pull --wait --wait-timeout 120 postgres
[[ $(version) -lt 170000 ]] && pass "rollback: new PostgreSQL 16 database" || fail "rollback: expected PostgreSQL 16"
old run --rm inkadra backup restore "$backup_file" >"$work/restore16.log" 2>&1 &&
  pass "rollback: backup made on 18 restored into 16" || fail "rollback restore: $(tail -n8 "$work/restore16.log")"
old up -d --wait --wait-timeout 180
[[ $(sign_in) == 200 ]] && p=$(projects) || p=
[[ $p == *"Before the upgrade"* && $p == *"After the upgrade"* ]] && pass "rollback: both projects there, sign-in works" ||
  fail "rollback: projects after restore: $p"

# A. Back to the old volume exactly as it was before the upgrade. Only a dump and restore leaves
# it so; pgautoupgrade changed it, and there the way back is a copy of the volume.
if [[ $mode == dump ]]; then
  old down
  unset POSTGRES_DATA
  old up -d --wait --wait-timeout 180
  [[ $(sign_in) == 200 ]] && p=$(projects) || p=
  [[ $p == *"Before the upgrade"* && $p != *"After the upgrade"* ]] && pass "rollback: old volume untouched" ||
    fail "rollback: old volume has: $p"
fi

if [[ $failed != 0 ]]; then
  echo "== PostgreSQL 16 to 18 ($mode): FAILED"
  exit 1
fi
echo "== PostgreSQL 16 to 18 ($mode): passed"
