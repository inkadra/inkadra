#!/usr/bin/env bash
# Upgrades from the last release with real data (#793), restores a backup of that release on
# this version (#792) and goes back to the release the documented way (#805), with the
# compose.yaml of this repository:
#
# 1. The release (INKADRA_FROM_TAG) imports the two sample projects (boards, files, schedule,
#    crew) through the API, saves a named version, and makes an Inkadra backup.
# 2. This version (INKADRA_TAG) starts on that database: migrations run on real rows. The data,
#    the files (same bytes) and the old version are there, and every board opens in the
#    collaboration server (a saved version loads it there).
# 3. The backup of the release is restored by this version into a new, empty database (its
#    migrations, the data, then the newer migrations on top), with the same checks.
# 4. Rollback (docs/self-hosting/upgrades.md): the release restores its own backup into a new,
#    empty database and finds everything it had.
#
#   INKADRA_FROM_TAG=0.9.0 INKADRA_TAG=edge scripts/test-release-upgrade.sh
#
# Needs Docker with Compose 2.24 or newer, curl, jq and openssl, and port 3000 free
# (INKADRA_PORT). The release image is pulled from ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=inkadra-release-upgrade
port=${INKADRA_PORT:-3000}
url="http://localhost:$port"
image=${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}
tag=${INKADRA_TAG:-edge}
from_tag=${INKADRA_FROM_TAG:?set INKADRA_FROM_TAG to the last release, e.g. 0.9.0}
email=upgrade@example.com
password=correct-horse-battery
# Boards opened per step; a person may save 20 versions an hour.
max_boards=19

cat >"$work/.env" <<ENV
PUBLIC_URL=$url
INKADRA_PORT=$port
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
INKADRA_IMAGE=$image
FEEDBACK_RELAY_URL=
ENV

compose() { docker compose --progress quiet -p "$project" --project-directory "$root" --env-file "$work/.env" -f "$root/compose.yaml" "$@"; }
release() { INKADRA_TAG=$from_tag compose "$@"; }
current() { INKADRA_TAG=$tag compose "$@"; }
sql() { compose exec -T postgres psql -U inkadra -d inkadra -Atqc "$1"; }

failed=0
cleanup() {
  if [[ $failed != 0 ]]; then compose logs --no-color --tail 80 inkadra || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  # Folders made by containers belong to other users.
  docker run --rm -v "$work:/w" --entrypoint sh postgres:18-alpine -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

pass() { echo "  ok   $1"; }
fail() {
  echo "  FAIL $1"
  failed=1
}

c() { curl -s --max-time 60 -H "Origin: $url" "$@"; }
jar="$work/cookies"
sign_up() { c -o /dev/null -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' --data "{\"name\":\"Upgrade Test\",\"email\":\"$email\",\"password\":\"$password\"}" "$url/api/auth/sign-up/email"; }
sign_in() { c -o /dev/null -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' --data "{\"email\":\"$email\",\"password\":\"$password\"}" "$url/api/auth/sign-in/email"; }
api() { c -b "$jar" "$url/api/v1$1"; }
newest_backup() { compose exec -T inkadra sh -c 'ls /data/backups/inkadra-backup-*.zip | sort | tail -n1' | tr -d '\r'; }

# What must survive: ids of boards, assets and shooting days, the bytes of the files, the
# saved version. Later versions may add rows (a Production board), never lose these.
ids() { sql "select coalesce(string_agg(id::text, ',' order by id), '') from $1"; }
present() { # table, comma-separated ids: how many of them are there
  [[ -z $2 ]] && echo 0 && return
  sql "select count(*) from $1 where id = any('{$2}'::uuid[])"
}
files_digest() { # sha256 of every listed asset's file, as the API serves it
  local id out=""
  for id in ${1//,/ }; do
    out+="$id $(c -L -b "$jar" "$url/api/v1/assets/$id/file" | sha256sum | cut -c1-16)"$'\n'
  done
  printf '%s' "$out"
}

# Every board of the imported projects opens in the collaboration server: saving a named
# version loads the document there (and migrates it to this version's schema).
open_boards() { # label
  local opened=0 broken=0 board code
  # The limit of saved versions per person lives in Valkey and outlasts a restart: each step
  # starts with the whole budget.
  compose exec -T valkey sh -c "valkey-cli --scan --pattern '*versions-routes:saves*' | xargs -r valkey-cli del" >/dev/null
  for board in $(sql "select id from board where deleted_at is null order by id limit $max_boards"); do
    code=$(c -o "$work/version.json" -w '%{http_code}' -b "$jar" -H 'Content-Type: application/json' \
      --data "{\"name\":\"$1\"}" "$url/api/v1/boards/$board/versions")
    if [[ $code == 201 || $code == 200 ]]; then opened=$((opened + 1)); else
      broken=$((broken + 1))
      echo "       board $board: $code $(head -c 300 "$work/version.json")"
    fi
  done
  [[ $broken == 0 && $opened -gt 0 ]] && pass "$1: $opened boards open in the collaboration server" ||
    fail "$1: $broken boards did not open ($opened did)"
}

check_data() { # label
  local label=$1 n
  for t in board asset shooting_day; do
    n=$(present "$t" "${before_ids[$t]}")
    [[ $n == "${before_count[$t]}" ]] && pass "$label: all ${before_count[$t]} rows of $t" ||
      fail "$label: $t has $n of ${before_count[$t]}"
  done
  [[ $(sign_in) == 200 ]] && pass "$label: sign-in with the same password" || fail "$label: sign-in"
  local p
  p=$(api /projects)
  [[ $p == *"$project_a"* && $p == *"$project_b"* ]] && pass "$label: both projects listed" ||
    fail "$label: projects: $(head -c 300 <<<"$p")"
  [[ $(files_digest "$asset_ids") == "$digest_before" ]] &&
    pass "$label: $(wc -w <<<"${asset_ids//,/ }") files serve the same bytes" || fail "$label: files differ or do not serve"
  code=$(c -o /dev/null -w '%{http_code}' -b "$jar" "$url/api/v1/boards/$version_board/versions/$version_id/state")
  [[ $code == 200 ]] && pass "$label: the version saved by $from_tag opens" || fail "$label: old version state ($code)"
  if compose logs --no-color inkadra 2>&1 | grep -q 'stored document cannot be read'; then
    fail "$label: a stored board document could not be read"
  fi
}

echo "== Upgrade from $from_tag to $tag"

# ------------------------------------------------------------------ 1. the release
release up -d --quiet-pull --wait --wait-timeout 240
pass "$from_tag starts ($(sql 'select count(*) from drizzle.__drizzle_migrations') migrations)"
[[ $(sign_up) == 200 ]] && pass "first account created" || fail "sign-up"

for sample in last-train low-tide; do
  transfer=$(c -b "$jar" -H 'Content-Type: application/zip' --data-binary "@$root/apps/server/demo/$sample.inkadra" \
    "$url/api/v1/projects/import" | jq -r '.id // empty')
  status=
  for _ in $(seq 1 90); do
    status=$(api "/transfers/$transfer" | jq -r '.status // empty')
    [[ $status == ready || $status == failed ]] && break
    sleep 2
  done
  [[ $status == ready ]] && pass "$sample imported through the API" || fail "import of $sample: ${status:-no transfer}"
done
mapfile -t names < <(api /projects | jq -r '.. | objects | select(has("rootBoardId")) | .name')
project_a=${names[0]:-}
project_b=${names[1]:-}
[[ -n $project_a && -n $project_b ]] || fail "imported projects not listed"
# Media previews of the release finish in the background; let the queue settle before the
# backup, so the files it lists are the ones on disk.
sleep 20

declare -A before_ids before_count
for t in board asset shooting_day; do
  before_ids[$t]=$(ids "$t")
  before_count[$t]=$(present "$t" "${before_ids[$t]}")
done
[[ ${before_count[board]} -gt 2 && ${before_count[asset]} -gt 0 ]] &&
  pass "seeded ${before_count[board]} boards, ${before_count[asset]} files, ${before_count[shooting_day]} shooting days" ||
  fail "seed too small: ${before_count[*]}"
asset_ids=$(sql "select coalesce(string_agg(id::text, ',' order by id), '') from (select id from asset where status = 'ready' order by id limit 10) a")
digest_before=$(files_digest "$asset_ids")
[[ -n $asset_ids && $digest_before != *e3b0c44298fc1c14* ]] && pass "files serve on $from_tag" || fail "files on $from_tag"

# The largest board, the one a missed migration step would most likely break.
version_board=$(sql "select board_id from board_doc order by length(state) desc limit 1")
version_id=$(c -b "$jar" -H 'Content-Type: application/json' --data '{"name":"Before the upgrade"}' \
  "$url/api/v1/boards/$version_board/versions" | jq -r '.. | objects | .id? // empty' | head -n1)
[[ -n $version_id ]] && pass "named version saved on $from_tag" || fail "version on $from_tag"
migrations_before=$(sql 'select count(*) from drizzle.__drizzle_migrations')

compose exec -T -u node inkadra node /app/dist/main.js backup create >"$work/backup.log" 2>&1 &&
  backup_file=$(newest_backup) && [[ -n $backup_file ]] && pass "backup made by $from_tag" ||
  fail "backup create: $(tail -n5 "$work/backup.log")"
release stop inkadra

# ------------------------------------------------------- 2. upgrade on the same database
current up -d --wait --wait-timeout 240
migrations_after=$(sql 'select count(*) from drizzle.__drizzle_migrations')
[[ $migrations_after -ge $migrations_before ]] &&
  pass "$tag starts on the data of $from_tag ($migrations_before migrations before, $migrations_after now)" ||
  fail "migrations: $migrations_before before, $migrations_after now"
[[ $(c "$url/api/v1/health") == *'"status":"ok"'* ]] && pass "health ok" || fail "health"
check_data "upgrade"
open_boards "After the upgrade"
current stop inkadra

# ---------------------------------------- 3. the backup of the release restored on this one
echo "POSTGRES_DATA=postgres18-data" >>"$work/.env"
compose up -d --wait --wait-timeout 120 postgres valkey
if current run --rm inkadra backup restore "$backup_file" >"$work/restore.log" 2>&1; then
  report=$(grep -o '"migrationsBefore":[0-9]*,"migrationsAfter":[0-9]*' "$work/restore.log" | tail -n1)
  pass "backup of $from_tag restored by $tag ($report)"
else
  fail "restore: $(tail -n8 "$work/restore.log")"
fi
current up -d --wait --wait-timeout 240
check_data "restore"
open_boards "After the restore"
current stop inkadra

# ------------------------------------------------- 4. rollback: the release, its own backup
mkdir "$work/pg-rollback"
docker run --rm -v "$work/pg-rollback:/p" --entrypoint chown postgres:18-alpine 70:70 /p
sed -i '/^POSTGRES_DATA=/d' "$work/.env"
echo "POSTGRES_DATA=$work/pg-rollback" >>"$work/.env"
compose up -d --wait --wait-timeout 120 postgres valkey
release run --rm inkadra backup restore "$backup_file" >"$work/rollback.log" 2>&1 &&
  pass "rollback: $from_tag restores its own backup into a new database" ||
  fail "rollback restore: $(tail -n8 "$work/rollback.log")"
release up -d --wait --wait-timeout 240
check_data "rollback"

if [[ $failed != 0 ]]; then
  echo "== Upgrade from $from_tag to $tag: FAILED"
  exit 1
fi
echo "== Upgrade from $from_tag to $tag: passed"
