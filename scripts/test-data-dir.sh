#!/usr/bin/env bash
# Checks that Inkadra starts on a data folder it does not own, as after an upgrade on a host
# folder created by root: compose.yaml must give the folder to uid 1000 once and run as that
# user, and a container started as uid 1000 directly must explain what to do instead of failing
# with a stack trace.
#
#   scripts/test-data-dir.sh
#
# Needs Docker with Compose and port 3000 free. The image is
# ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}; CI sets it to the image it built.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=inkadra-data-dir-test
image="${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}"
data="$work/data"

cat >"$work/.env" <<ENV
PUBLIC_URL=http://localhost:3000
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
INKADRA_TAG=${INKADRA_TAG:-edge}
INKADRA_IMAGE=${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}
INKADRA_DATA=$data
ENV

compose() { docker compose --progress quiet -p "$project" --project-directory "$root" --env-file "$work/.env" -f "$root/compose.yaml" "$@"; }
# Runs a command as root in a throwaway container that sees the data folder at /d.
as_root() { docker run --rm --user 0:0 --entrypoint sh -v "$data:/d" "$image" -c "$1"; }

failed=0
cleanup() {
  if [[ $failed != 0 ]]; then compose logs --no-color --tail 80 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  as_root 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

pass() { echo "  ok   $1"; }
fail() {
  echo "  FAIL $1"
  failed=1
}

# A folder and an older file owned by root, like a bind mount created with mkdir on the host.
mkdir -p "$data"
as_root 'chown 0:0 /d && chmod 755 /d && mkdir -p /d/files && echo old >/d/files/old.txt && chown -R 0:0 /d'

# Started as uid 1000 directly (no user and cap_add): it must stop with an explanation.
out=$(docker run --rm --cap-drop ALL --security-opt no-new-privileges:true -v "$data:/data" "$image" all 2>&1) && status=0 || status=$?
if [[ $status != 0 && $out == *"cannot write to /data"*"chown -R 1000:1000"* ]]; then
  pass "as uid 1000 on a root-owned folder: clear error"
else
  fail "as uid 1000 on a root-owned folder: exit $status, output: $out"
fi

if compose up -d --wait --wait-timeout 120; then
  pass "compose.yaml starts on a root-owned folder"
else
  fail "compose.yaml did not become healthy"
  exit 1
fi

owners=$(as_root 'stat -c %u:%g /d /d/files /d/files/old.txt | sort -u')
[[ $owners == "1000:1000" ]] && pass "data folder given to uid 1000" || fail "owners after start: $owners"

# The server process: uid 1000 and no capabilities left.
proc=$(compose exec -T inkadra sh -c 'for p in /proc/[0-9]*; do if tr "\0" " " <"$p/cmdline" 2>/dev/null | grep -q "^node /app/dist/main.js "; then grep -E "^(Uid|CapEff):" "$p/status" && break; fi; done' || true)
if [[ $proc == *"Uid:"*"1000"* && $proc == *"CapEff:"*"0000000000000000"* ]]; then
  pass "server runs as uid 1000 without capabilities"
else
  fail "server process: $proc"
fi

# A second start finds nothing to fix.
compose restart inkadra >/dev/null
compose up -d --wait --wait-timeout 120 >/dev/null
fixes=$(compose logs --no-color inkadra | grep -c "giving /data to uid" || true)
[[ $fixes == 1 ]] && pass "ownership fixed once, not on every start" || fail "ownership fixed $fixes times"

[[ $failed == 0 ]] && echo "data folder test passed" || {
  echo "data folder test failed"
  exit 1
}
