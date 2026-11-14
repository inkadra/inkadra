# Troubleshooting

Check container status, logs and health:

```sh
docker compose ps
docker compose logs --tail 100 inkadra
curl -s http://127.0.0.1:3000/api/v1/health
```

`/api/v1/health` answers `"status":"ok"` when the database and the job queue are reachable,
and names the one that is not otherwise. Once you can sign in, **Settings → Server status**
checks the network, the proxy and the services from the app.

**`set AUTH_SECRET in .env`, or another `set … in .env`.** `docker compose` cannot find the value:
you are in another folder, or the line in `.env` is empty. See [Install](README.md#install), step 2.

**`permission denied while trying to connect to the Docker daemon socket`.** Your user is not in the
`docker` group: run `sudo usermod -aG docker $USER`, sign out and in again, or use `sudo docker`.

**`port is already allocated` or `address already in use`.** Something else listens on port 3000 of
the machine. Choose another with `INKADRA_PORT=3100` in `.env`, and use it in `PUBLIC_URL` if you
reach Inkadra directly.

**The page does not open from another computer.** `compose.yaml` publishes the port only on this
machine, on purpose: point a reverse proxy at it. For access over your LAN or Tailscale without one,
read [Direct LAN and Tailscale access](configuration.md#direct-lan-and-tailscale-access) first.

**Inkadra does not start: "Invalid configuration".** The log lists the settings that are
missing or wrong. `PUBLIC_URL` must be a full address without a path, `AUTH_SECRET` at least 32
characters.

**"cannot write to /data" or "permission denied" on `/data`.** A host folder in `INKADRA_DATA`
must belong to uid 1000. The `compose.yaml` of the current release fixes that at startup; with
an older one, or a container started as uid 1000 directly, run the `chown` the error shows. For
`POSTGRES_DATA` the owner is uid 70. See [Storage](storage.md#data-on-different-disks).

**`postgres` refuses to start: "The volume holds a PostgreSQL 16 database".** It is an install from
before PostgreSQL 18: see [Upgrades](upgrades.md#upgrading-to-postgresql-18).

**Videos and PDFs show a generic card.** The [standard image](README.md#the-image) includes media tools. Check that
[media previews](configuration.md#media-previews) are enabled and inspect worker logs for conversion
errors. On 0.9.0 use `0.9.0-media`. Existing videos can have missing copies regenerated from
**Settings → Video** on current `main`; this does not regenerate PDF thumbnails.

**The report icon is missing, or a report waits.** Without a destination, reports are off and the
icon is hidden: see [What leaves your server](README.md#what-leaves-your-server). **Settings → Reports** shows what is waiting and why: a waiting report reads _Waiting to be sent_, and its
expanded row has **Try again**.

**The page loads but sign-in fails or loops back to the login.** Check that the proxy replaces
forwarded host/protocol headers and that `TRUST_PROXY` accepts its actual peer address.
HTTPS uses Secure host cookies; direct HTTP uses plain host-only cookies. Sign in separately
on each hostname. Google and OIDC require the canonical `PUBLIC_URL`; password sign-in also
works on [private HTTP addresses](configuration.md#direct-lan-and-tailscale-access).

**Sign-in is refused for everyone at once, as if after too many attempts.** Inkadra sees every
request coming from the proxy: `TRUST_PROXY` does not include the proxy's address. See
[TRUST_PROXY](configuration.md#trust_proxy).

**Boards do not update live.** WebSocket upgrades on `/collab` do not reach Inkadra, or the
proxy closes them after a minute. In split mode, `/collab` must go to the `collab` container on
port 3001. Check with

```sh
curl -si --http1.1 -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  https://inkadra.example.com/collab | head -n1
```

which must print `HTTP/1.1 101 Switching Protocols`.

**Large uploads fail at the same point every time.** The proxy limits the request size or cuts
slow requests: see the settings for your proxy in [Reverse proxy](reverse-proxy.md). An error
page in the proxy's style (not Inkadra's) gives it away.

**The container is "unhealthy".** `docker inspect --format '{{json .State.Health}}' <container>`
shows what the health check saw. For `web` and `all` it calls `/api/v1/health`, for `collab`
an HTTP check on the collaboration server's `/`; `worker` is healthy while it runs.

Problem not listed here? Open a [discussion](https://github.com/inkadra/inkadra/discussions)
with the relevant log lines, with secrets and private addresses removed.
