# Self-hosting

Inkadra runs on any machine with Docker: a VPS, a home server, a NAS. You need
- Docker Engine 24 or newer with the Compose plugin (`docker compose version`), on amd64 or arm64;
- a (sub)domain for Inkadra, such as `inkadra.example.com`, and a reverse proxy that serves it
  over HTTPS: the proxy can be one of the examples in this repository;
- 2 GB of RAM and disk space for your files.

| Page                                  | What it covers                                          |
| ------------------------------------- | ------------------------------------------------------- |
| This page                             | Installing, the image and its roles, compose variants   |
| [Configuration](configuration.md)     | Every setting in `.env`                                 |
| [Sign-in](sign-in.md)                 | Google, OIDC, email, invitations, two-factor            |
| [Reverse proxy](reverse-proxy.md)     | Caddy, Traefik, Nginx, Nginx Proxy Manager, Pangolin    |
| [Storage](storage.md)                 | Where files go: volume, host folder, S3, bundled RustFS |
| [Upgrades](upgrades.md)               | Versions, updating, verifying images                    |
| [Troubleshooting](troubleshooting.md) | What to check when something does not work              |

## Install

```sh
mkdir inkadra && cd inkadra
curl -fsSLO https://raw.githubusercontent.com/inkadra/inkadra/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/inkadra/inkadra/main/.env.example
```

Edit `.env`: set `PUBLIC_URL` to the address people will use, and fill `AUTH_SECRET` and
`POSTGRES_PASSWORD` with random values:

```sh
sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/; s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
```

Then start it and point your reverse proxy at port 3000 (see [Reverse proxy](reverse-proxy.md)):

```sh
docker compose up -d
docker compose ps        # inkadra, postgres and valkey should be "healthy"
```

Open `PUBLIC_URL` in a browser. The first account you create becomes the administrator; after
that, sign-up is closed unless `REGISTRATION=open`.

For a release instead of the latest commit of `main`, download the deployment files attached
to the [release](https://github.com/inkadra/inkadra/releases): they pin `INKADRA_TAG` to that
version.

### With a proxy in the same stack

If nothing else uses ports 80 and 443 on the machine, let Compose run the proxy too. Download
the repository files (or the release archive), set `INKADRA_DOMAIN` in `.env` to the host of
`PUBLIC_URL`, and add the proxy's file:

```sh
git clone --depth 1 https://github.com/inkadra/inkadra.git && cd inkadra
cp .env.example .env     # and edit it as above, plus INKADRA_DOMAIN
docker compose -f compose.yaml -f deploy/proxy/caddy/compose.yaml up -d
```

Caddy gets the certificate by itself. Traefik and Nginx are there too; see
[Reverse proxy](reverse-proxy.md).

### Portainer, Dockhand, TrueNAS and other stack managers

Stack managers take a single compose file. To use a variant, let Compose merge the files and
paste the result:

```sh
docker compose -f compose.yaml -f deploy/compose.split.yaml config > stack.yaml
```

`config` writes the values of `.env` into `stack.yaml`, secrets included: keep that file private,
or run it with an `.env` that has placeholders and fill them in the manager's environment
editor. On TrueNAS, keep the data on a dataset: see [Storage](storage.md#a-folder-on-the-host).

## Installing as an app

People can install Inkadra from the browser as an app with its own window and icon: in Chrome
and Edge with the install button in the address bar, on Android with _Add to home screen_, in
Safari on iPhone and iPad with _Share → Add to Home Screen_, in Safari on the Mac with
_File → Add to Dock_. There is nothing to configure on the server, but the browser only offers it
over **HTTPS** with a valid certificate (or on `localhost`): on plain HTTP the app keeps working
in the browser, without the install option, the offline page and the update prompt.

The app is the same web app, so it needs the server: without a connection it shows an offline
page and reloads by itself when the network is back. After you upgrade Inkadra, open apps and
tabs show _New version available — Update_; until someone presses it they keep running the
version they started with. If a board is still saving or an upload is running, the update
waits for them. The service worker that does this never stores API responses,
files, sign-in pages or anything tied to an account: see
[decision 0015](../decisions/0015-installable-web-app.md). A proxy in front of Inkadra must
serve `/sw.js` and `/manifest.webmanifest` as it receives them (the examples in `deploy/proxy`
do); if it adds a `Content-Security-Policy`, it needs `worker-src 'self'`, `manifest-src 'self'`
and must allow the inline `<script>` and `<style>` of `offline.html` and the inline theme script
of `index.html` (with `'unsafe-inline'` or their hashes).

## The image

One image, `ghcr.io/inkadra/inkadra`, built for `linux/amd64` and `linux/arm64`. Its command
selects the role:

| Command         | Role                                                                |
| --------------- | ------------------------------------------------------------------- |
| `all` (default) | Web app, API, collaboration and background jobs in one container    |
| `web`           | Web app and API on port 3000                                        |
| `collab`        | Real-time collaboration (WebSocket) on port 3001                    |
| `worker`        | Background jobs (thumbnails, email, maintenance)                    |
| `migrate`       | Apply database migrations and exit (`web` and `all` do it on start) |

It needs Postgres 16 and Valkey 8 (or Redis 7); `compose.yaml` runs both. With your own
Postgres, the `pg_trgm` extension must be available (it is in the standard `contrib` package
and in the official images); a migration creates it as the database owner. The server runs as
user `node` (uid 1000) with a read-only root filesystem and no Linux capabilities; it writes
only to `/data`. `compose.yaml` starts the container as root with four capabilities, only so
that it can give `/data` to uid 1000 when a host folder belongs to someone else; it then
switches to uid 1000, which drops them. Each role has its own health check.

| Tag           | What it is                                                  |
| ------------- | ----------------------------------------------------------- |
| `0.2.0`       | One release. Recommended: pin it in `INKADRA_TAG`           |
| `0.2`         | The latest patch release of 0.2                             |
| `latest`      | The latest stable release                                   |
| `edge`        | The latest commit of `main`: for testing, not for real work |
| `sha-1a2b3c4` | One commit                                                  |

Every tag also exists with the suffix `-media` (`0.2.0-media`, `latest-media`, `edge-media`…):
the same image plus ffmpeg, a few hundred MB larger. With it, videos get a poster thumbnail on the
board and their duration. Without it they upload and play the same, with a generic card. Set
`INKADRA_TAG=latest-media` (or the version you pin, with `-media`) to use it. The server reports
which of these it can do in `GET /api/v1/instance` (`media.videoPosters`); previews of camera RAW
files are not available in either image yet (`media.rawPreviews` is `false`).

The `-media` image adds Debian's `ffmpeg` package and the libraries it depends on. Debian builds
ffmpeg with GPL components, so that package is under the GPL (version 2 or later), and some of its
libraries under the LGPL; their licence texts are in the image under `/usr/share/doc/<package>/copyright`.
The GPL is compatible with distributing Inkadra under the AGPL-3.0. The server only runs the
`ffmpeg` and `ffprobe` programs and does not link to them.

## Compose variants

`compose.yaml` is the all-in-one setup. Other files in `deploy/` change it when added with `-f`
after it; they combine, in this order:

| File                                | Changes                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `deploy/compose.split.yaml`         | `web`, `collab` and `worker` in separate containers         |
| `deploy/compose.s3.yaml`            | Files in an S3-compatible bucket you already have           |
| `deploy/compose.rustfs.yaml`        | Files in a bundled S3-compatible store (RustFS)             |
| `deploy/proxy/<proxy>/compose.yaml` | A reverse proxy in the stack: `caddy`, `traefik` or `nginx` |

Split mode is for larger teams: you can restart or scale the parts on their own, and a busy
worker does not slow down the web app. The proxy must send `/collab` to the `collab` container
on port 3001: with the bundled proxies, set `INKADRA_COLLAB_UPSTREAM=collab:3001` (Caddy,
Nginx) or add `deploy/proxy/traefik/compose.split.yaml` (Traefik).

```sh
docker compose -f compose.yaml -f deploy/compose.split.yaml -f deploy/proxy/caddy/compose.yaml up -d
```

## Backups

Until the built-in backup arrives (1.0), back up the database with

```sh
docker compose exec -T postgres pg_dump -U inkadra -Fc inkadra > inkadra-$(date +%F).dump
```

and copy the files: the `inkadra-data` volume (or your `INKADRA_DATA` folder), or the bucket.
