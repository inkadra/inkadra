# Self-hosting

Inkadra ships as one Docker image, `ghcr.io/inkadra/inkadra`, that runs in different roles:

| Command         | Role                                                                |
| --------------- | ------------------------------------------------------------------- |
| `all` (default) | Web app, API, collaboration and background jobs in one container    |
| `web`           | Web app and API on port 3000                                        |
| `collab`        | Real-time collaboration (WebSocket) on port 3001                    |
| `worker`        | Background jobs (thumbnails, email, maintenance)                    |
| `migrate`       | Apply database migrations and exit (`web` and `all` do it on start) |

It needs Postgres 16 and Valkey 8 (or Redis 7). `compose.yaml` runs all three.

## Configuration

| Variable        | Required            | Meaning                                                                         |
| --------------- | ------------------- | ------------------------------------------------------------------------------- |
| `PUBLIC_URL`    | yes                 | Address people use, as served by your proxy, e.g. `https://inkadra.example.com` |
| `AUTH_SECRET`   | yes                 | At least 32 random characters: `openssl rand -hex 32`                           |
| `DATABASE_URL`  | yes                 | Postgres connection string                                                      |
| `REDIS_URL`     | for `worker`, `all` | Valkey or Redis connection string                                               |
| `INSTANCE_NAME` | no                  | Name shown in the app (default `Inkadra`)                                       |
| `REGISTRATION`  | no                  | `invite` (default) or `open`                                                    |
| `TRUST_PROXY`   | no                  | `true` (default) to read the client address from `X-Forwarded-For`              |
| `LOG_LEVEL`     | no                  | `info` (default), `debug`, `warn`…                                              |

The first account created on a new instance becomes its administrator. After that, sign-up is
closed unless `REGISTRATION=open`.

## Reverse proxy

Serve Inkadra on its own (sub)domain over HTTPS, proxy everything to port 3000 and allow
WebSocket upgrades on `/collab`. Uploads can be large: disable the request body limit or raise
it to at least a few GB, and raise read timeouts to several minutes.

Caddy:

```caddy
inkadra.example.com {
	reverse_proxy inkadra:3000
}
```

Tested examples for Traefik, Nginx and Nginx Proxy Manager will follow in 0.2.

## Split mode

For larger installs, run the roles as separate containers:

```sh
docker compose -f compose.yaml -f deploy/compose.split.yaml up -d
```

and route `/collab` to the `collab` service (port 3001) in your proxy.

## Upgrades

```sh
docker compose pull && docker compose up -d
```

Migrations run on start. Back up the `postgres-data` and `inkadra-data` volumes first.
