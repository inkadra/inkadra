#!/usr/bin/env bash
# Starts Inkadra behind one of the reverse proxy examples in deploy/proxy and checks what a
# proxy must get right: HTTPS redirect, forwarded headers, secure cookies, WebSocket upgrade
# on /collab, request bodies larger than the proxy defaults and resumable uploads.
#
#   scripts/test-proxy.sh <caddy|traefik|nginx> [all|split]
#
# Needs Docker with Compose, curl and openssl, and ports 80 and 443 free. The image is
# ${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}:${INKADRA_TAG:-edge}; CI sets it to the image it built.
set -euo pipefail

proxy=${1:?usage: test-proxy.sh <caddy|traefik|nginx> [all|split]}
mode=${2:-all}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project="inkadra-proxy-test-$proxy-$mode"
domain=localhost
url="https://$domain"

files=(-f "$root/compose.yaml")
[[ $mode == split ]] && files+=(-f "$root/deploy/compose.split.yaml")
files+=(-f "$root/deploy/proxy/$proxy/compose.yaml")
[[ $mode == split && -f $root/deploy/proxy/$proxy/compose.split.yaml ]] &&
  files+=(-f "$root/deploy/proxy/$proxy/compose.split.yaml")

cat >"$work/.env" <<ENV
PUBLIC_URL=$url
INKADRA_DOMAIN=$domain
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
INKADRA_TAG=${INKADRA_TAG:-edge}
INKADRA_IMAGE=${INKADRA_IMAGE:-ghcr.io/inkadra/inkadra}
NGINX_CERTS=$work/certs
TRAEFIK_CERTRESOLVER=
ENV
[[ $mode == split ]] && echo "INKADRA_COLLAB_UPSTREAM=collab:3001" >>"$work/.env"

# Nginx needs certificate files; Caddy and Traefik make their own for localhost.
mkdir -p "$work/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$domain" \
  -addext "subjectAltName=DNS:$domain" \
  -keyout "$work/certs/privkey.pem" -out "$work/certs/fullchain.pem" 2>/dev/null
chmod 644 "$work/certs/"*.pem

compose() { docker compose --progress quiet -p "$project" --project-directory "$root" --env-file "$work/.env" "${files[@]}" "$@"; }

failed=0
cleanup() {
  if [[ $failed != 0 ]]; then compose logs --no-color --tail 80 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

pass() { echo "  ok   $1"; }
fail() {
  echo "  FAIL $1"
  failed=1
}

echo "== $proxy ($mode)"
compose up -d --quiet-pull --wait --wait-timeout 180

c() { curl -ks --http1.1 --max-time 20 "$@"; }
ws() {
  c -i -N --max-time 5 -H "Origin: $url" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" "$@" \
    "$url/collab" || true
}

# The proxy may need a moment to get its certificate and find the upstreams: Traefik adds the
# collab route only once that container reports healthy.
for _ in $(seq 1 90); do
  if curl -ksf -o /dev/null "$url/api/v1/health" && [[ $(ws | head -n1) == *" 101"* ]]; then break; fi
  sleep 1
done

status=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$domain/boards?x=1")
[[ $status =~ ^30[1278]\ https://$domain/boards\?x=1$ ]] && pass "HTTP redirects to HTTPS" ||
  fail "HTTP redirects to HTTPS (got: $status)"

body=$(c "$url/api/v1/health")
[[ $body == *'"status":"ok"'* ]] && pass "health through the proxy" || fail "health (got: $body)"

type=$(c -o /dev/null -w '%{content_type}' "$url/")
[[ $type == text/html* ]] && pass "web app served" || fail "web app (got: $type)"

# Installing the app: the manifest with its own type, and the service worker revalidated.
type=$(c -o /dev/null -w '%{content_type}' "$url/manifest.webmanifest")
[[ $type == application/manifest+json* ]] && pass "web app manifest served" ||
  fail "web app manifest (got: $type)"
headers=$(c -D - -o /dev/null "$url/sw.js" | tr -d '\r')
if grep -qi '^content-type: \(application\|text\)/javascript' <<<"$headers" &&
  grep -qi '^cache-control: no-cache' <<<"$headers"; then
  pass "service worker served, not cached"
else
  fail "service worker (headers: $(tr '\n' ' ' <<<"$headers"))"
fi

body=$(c "$url/api/v1/instance")
[[ $body == *"\"publicUrl\":\"$url\""* ]] && pass "instance reports PUBLIC_URL" ||
  fail "instance (got: $body)"

headers=$(c -D - -o /dev/null -c "$work/cookies" -H "Origin: $url" -H 'Content-Type: application/json' \
  --data '{"name":"Proxy Test","email":"proxy@example.com","password":"correct-horse-battery"}' \
  "$url/api/auth/sign-up/email")
if grep -qi '^set-cookie: __Secure-inkadra.*; Secure' <<<"$headers"; then
  pass "sign-up sets a Secure session cookie"
else
  fail "secure session cookie (headers: $(tr '\r\n' '  ' <<<"$headers"))"
fi

code=$(c -o /dev/null -w '%{http_code}' -b "$work/cookies" "$url/api/v1/me")
[[ $code == 200 ]] && pass "session works through the proxy" || fail "session (got: $code)"

# The app sees the client address, not the proxy's: the proxy sets X-Forwarded-For and
# TRUST_PROXY accepts it. The test client reaches the proxy from the Docker network gateway.
gateway=$(docker network inspect "${project}_default" -f '{{(index .IPAM.Config 0).Gateway}}')
c -o /dev/null "$url/api/v1/instance?ip-check"
sleep 1
if compose logs --no-color inkadra | grep 'ip-check' | grep -q "\"remoteAddress\":\"$gateway\""; then
  pass "client address forwarded ($gateway)"
else
  fail "client address forwarded: expected $gateway in $(compose logs --no-color inkadra | grep ip-check | tail -1)"
fi

upgrade=$(ws -b "$work/cookies")
[[ $(head -n1 <<<"$upgrade") == *" 101"* ]] && pass "WebSocket upgrade on /collab" ||
  fail "WebSocket upgrade (got: $(head -n1 <<<"$upgrade"))"

# A JSON body over Nginx's 1 MB default must reach Inkadra (whose own limit is 2 MB).
padding=$(head -c $((1536 * 1024)) /dev/zero | tr '\0' 'x')
printf '{"name":"Proxy test","padding":"%s"}' "$padding" >"$work/big.json"
answer=$(c -o /dev/null -w '%{http_code} %{content_type}' -b "$work/cookies" -H "Origin: $url" \
  -H 'Content-Type: application/json' --data-binary "@$work/big.json" "$url/api/v1/projects")
[[ $answer == *application/json* ]] && pass "1.5 MB request body reaches Inkadra ($answer)" ||
  fail "large request body stopped by the proxy (got: $answer)"

# A resumable upload with one 60 MiB chunk, larger than the 50 MiB chunks the clients send.
project_id=$(c -b "$work/cookies" -H "Origin: $url" -H 'Content-Type: application/json' \
  --data '{"name":"Upload test"}' "$url/api/v1/projects" | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p')
size=$((60 * 1024 * 1024))
meta="projectId $(printf %s "$project_id" | base64 -w0),filename $(printf proxy-test.bin | base64 -w0),filetype $(printf application/octet-stream | base64 -w0)"
created=$(c -D - -o /dev/null -b "$work/cookies" -H "Origin: $url" -X POST -H 'Tus-Resumable: 1.0.0' \
  -H "Upload-Length: $size" -H "Upload-Metadata: $meta" "$url/api/v1/uploads" | tr -d '\r')
if [[ $(head -n1 <<<"$created") == *" 404"* ]]; then
  echo "  skip resumable upload: /api/v1/uploads is not there yet"
else
  location=$(sed -n 's/^[Ll]ocation: //p' <<<"$created")
  [[ $location == /* ]] && location="$url$location"
  head -c "$size" /dev/urandom >"$work/chunk.bin"
  patched=$(c --max-time 120 -o /dev/null -w '%{http_code}' -b "$work/cookies" -H "Origin: $url" \
    -X PATCH -H 'Tus-Resumable: 1.0.0' -H 'Upload-Offset: 0' \
    -H 'Content-Type: application/offset+octet-stream' --data-binary "@$work/chunk.bin" "$location" || true)
  offset=$(c -I -b "$work/cookies" -H "Origin: $url" -H 'Tus-Resumable: 1.0.0' "$location" |
    tr -d '\r' | sed -n 's/^[Uu]pload-[Oo]ffset: //p')
  [[ $patched == 204 && $offset == "$size" ]] && pass "60 MiB upload chunk through the proxy" ||
    fail "upload chunk (PATCH $patched, offset ${offset:-none} of $size, location ${location:-none})"
fi

if [[ $failed != 0 ]]; then
  echo "== $proxy ($mode): FAILED"
  exit 1
fi
echo "== $proxy ($mode): passed"
