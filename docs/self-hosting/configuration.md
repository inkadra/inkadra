# Configuration

Inkadra reads its settings from the environment. With Compose, put them in `.env` next to
`compose.yaml` and run `docker compose up -d`; [`.env.example`](../../.env.example) lists them with
their defaults. Never commit or share the real `.env`.

`compose.yaml` passes on the settings people change most. The others, in the tables below, reach
the server only if you add them to `environment`, for example `TZ`, `IMPORT_MAX_SIZE` and the
`VIDEO_PROXY_` limits and quality settings other than `VIDEO_PROXY_HWACCEL` and
`VIDEO_PROXY_VAAPI_DEVICE`. Put them in a `compose.override.yaml` next to `compose.yaml`, which
Compose reads by itself:

```yaml
services:
  inkadra: # add `collab` and `worker` too in split mode
    environment:
      TZ: Europe/Rome
      IMPORT_MAX_SIZE: 50GB
```

## Server

| Variable               | Default                          | Meaning                                                                                           |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                     | `development`, `production` or `test`                                                             |
| `PUBLIC_URL`           | required                         | Address people use, as served by your proxy, e.g. `https://inkadra.example.com`. No path          |
| `AUTH_SECRET_PREVIOUS` | unset                            | Optional previous encryption secret (at least 32 characters); see rotation below                  |
| `AUTH_SECRET`          | required                         | At least 32 random characters: `openssl rand -hex 32`. Changing it signs everyone out             |
| `DATABASE_URL`         | set by compose                   | Postgres connection string                                                                        |
| `REDIS_URL`            | set by compose                   | Valkey or Redis connection string. Required in production by `web`, `worker`, `all` and `collab`  |
| `INSTANCE_NAME`        | `Inkadra`                        | Name shown in the app                                                                             |
| `REGISTRATION`         | `invite`                         | `invite`: invitation required; `open`: anyone; `closed`: no new accounts, even with an invitation |
| `HOST`                 | `0.0.0.0`                        | Interface the web server listens on                                                               |
| `PORT`                 | `3000`                           | Port of the web server                                                                            |
| `COLLAB_PORT`          | `3001`                           | Port of the collaboration server, in split mode                                                   |
| `DATA_DIR`             | `/data`                          | Where files live; the `local` driver keeps them in `<DATA_DIR>/files`                             |
| `WEB_DIST`             |                                  | Folder of the built web app; unset for the default next to the server                             |
| `TRUST_PROXY`          | `loopback,linklocal,uniquelocal` | Who may tell Inkadra the client's address: set it to your proxy. See [below](#trust_proxy)        |
| `LOG_LEVEL`            | `info`                           | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                              |

`INSTANCE_NAME` and `REGISTRATION` are installation defaults; saved administrator choices
in Settings override them.

`TZ` sets the container time zone used for scheduled backups (UTC unless configured). It is
not forwarded by default. The image bundles Node 26.13; the host does not need Node.

| Variable                | Default | Meaning                                                                                                               |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `PRODUCTION_BOARD_MOVE` | `true`  | `true` or `false` only. Move existing shooting days at startup; [upgrade details](upgrades.md#after-090-current-main) |
| `OFFICE_PREVIEWS`       | off     | Only the exact value `true` enables Office routing/conversion. Requires the [Office worker setup](office.md)          |

Upload and import size units below use powers of 1024 (`1GB` = 1 GiB). Storage quota units
use powers of 1000. Boolean settings accept `true` or `false` unless stated otherwise.

## Files and uploads

| Variable                 | Default     | Meaning                                                                                                                                                      |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STORAGE_DRIVER`         | `local`     | `local`: files in the data volume. `s3`: files in a bucket. See [Storage](storage.md)                                                                        |
| `S3_ENDPOINT`            | AWS         | Address of an S3-compatible service, e.g. `https://s3.example.com`                                                                                           |
| `S3_REGION`              | `us-east-1` | Region of the bucket                                                                                                                                         |
| `S3_BUCKET`              |             | Required with `STORAGE_DRIVER=s3`. Bucket name                                                                                                               |
| `S3_ACCESS_KEY_ID`       |             | Access key                                                                                                                                                   |
| `S3_SECRET_ACCESS_KEY`   |             | Secret key                                                                                                                                                   |
| `S3_FORCE_PATH_STYLE`    | `false`     | `true` for MinIO, RustFS, Garage and most self-hosted stores                                                                                                 |
| `UPLOAD_MAX_SIZE`        | `20GB`      | Largest file anyone can upload, as bytes or with a unit (`500MB`, `4GB`); `0` for no limit                                                                   |
| `STORAGE_LIMIT`          |             | Space of the whole instance (`500GB`, in powers of 1000 as Settings shows sizes). Set, it wins over Settings → Storage and locks the field; `0` for no limit |
| `STORAGE_LIMIT_PER_USER` |             | Default space of each person (`5GB`), set and locked the same way. Administrators can lower it for a person, never raise it                                  |
| `IMPORT_MAX_SIZE`        | `20GB`      | Largest project archive an import accepts, compressed and in total uncompressed; `0` for no limit                                                            |
| `HEIC_PREVIEWS`          | `true`      | `false` stops Inkadra decoding HEIC photos from iPhones: they are kept, without a preview                                                                    |

## Board size limits

| Variable                | Default | Meaning                                                                              |
| ----------------------- | ------- | ------------------------------------------------------------------------------------ |
| `BOARD_MAX_STATE_BYTES` | `64MB`  | Encoded Yjs state per board, as bytes or with a unit (`64MB`, `1GB`; powers of 1024) |
| `BOARD_MAX_ELEMENTS`    | `20000` | Elements per board, a positive integer                                               |

Neither can be `0`: there is no setting without a limit.
The demo retains its stricter limits. Set these on every collaboration process.

Updates that exceed either limit are refused with a board-limit notice, and clips to a board
at a limit with 409. Existing data is never truncated: even boards already over the limits
remain readable and accept deletions, and restoring an older version is not limited.
Yjs retains history metadata, so deleting visible content may not bring encoded state below
the byte limit; an operator can raise it. The WebSocket message limit remains 16 MiB.

With `REDIS_URL`, product rate limits share atomic budgets across processes. Without it,
they use bounded in-memory windows, and so does each process while Valkey does not answer.

## Public demo

`DEMO_MODE` defaults to `false`. Setting it to `true` enables temporary sandboxes and disables
sign-in providers, email, reports, maps and heavy media previews. It is not a normal team
installation. See [demo configuration](../demo.md) before enabling it.

| Variable                                 | Default | Allowed values                                                |
| ---------------------------------------- | ------- | ------------------------------------------------------------- |
| `DEMO_TTL`                               | `1h`    | Seconds or an integer with `s`, `m`, `h`; at least one minute |
| `DEMO_STORAGE`                           | `100MB` | Space per sandbox, decimal units                              |
| `DEMO_MAX_SANDBOXES`                     | `50`    | Integer 1–10000                                               |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | unset   | Set both together; required in production demo mode           |

## Media previews

Media tools are included in standard builds after 0.9.0; that release needs `0.9.0-media`
(see [The image](README.md#the-image)). Current `main` adds the controls below.

In **Settings → Video**, administrators choose Light, Balanced (default) or High quality,
resolutions to store, and whether to encode while someone watches. By default, 480p, 720p and
1080p are stored, without upscaling; 2160p is off and also requires raising
`VIDEO_PROXY_RESOLUTION` above its default of 1080. Browser-playable originals get copies when
heavy (over 1080 pixels on the shorter side, 12 Mbit/s or 60 fps). Live encoding needs a GPU
and a successful worker benchmark. Without it, live resolutions are stored instead.
Changing settings affects new copies; use the page's regeneration control for missing or
outdated copies. Existing copies stay available until replacements are ready.

These four overrides are unset by default. Add them to each role's `environment` in Compose;
setting them locks the corresponding control in Settings.

| Variable                  | Allowed values                               | Meaning                                                            |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `VIDEO_QUALITY`           | `light`, `balanced`, `high`                  | Quality preset                                                     |
| `VIDEO_RENDITIONS`        | Comma-separated `480`, `720`, `1080`, `2160` | Resolutions to store; all others are off                           |
| `VIDEO_LIVE`              | `true`, `false`                              | Allow encoding while watched, if hardware supports it              |
| `VIDEO_LIVE_MAX_SESSIONS` | Integer 0–64                                 | Override the measured session capacity; `0` disables live encoding |

| Variable                      | Default                  | Meaning                                                                                                                                                                                                               |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAW_PREVIEWS`                | `true`                   | Thumbnails of camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2) from the JPEG preview the camera embedded                                                                                                     |
| `PDF_PREVIEWS`                | `true`                   | Thumbnails of page 1 of PDFs and their page count, rendered once on upload                                                                                                                                            |
| `VIDEO_PROXIES`               | `true`                   | Enable playable copies of unsupported or heavy videos. `false` disables creation                                                                                                                                      |
| `VIDEO_PROXY_MAX_DURATION`    | `7200`                   | Longest video, in seconds, that gets a playable copy; `0` for no limit                                                                                                                                                |
| `VIDEO_PROXY_MAX_SOURCE_SIZE` | `0`                      | Largest video that gets a playable copy, as bytes or with a unit; `0` (the default) for no limit: the duration limit and the free-space check remain                                                                  |
| `VIDEO_PROXY_RESOLUTION`      | unset (`1080`), 144–2160 | Largest shorter side of a copy in pixels (`1080` gives 1920×1080 at most); never upscaled                                                                                                                             |
| `VIDEO_PROXY_BITRATE`         | unset                    | Cap on the peak video bitrate of every copy (`5M`, `2500k`). Unset, the quality preset sets the rate by size and frame rate: about 46 MB per minute for 1080p (decision 0128)                                         |
| `VIDEO_PROXY_CONCURRENCY`     | `1`, `2` with a GPU      | Copies one worker makes at once, at most `4`. Count 1 to 2 GB of RAM per copy at 1080p (each is capped at 4 GiB of address space) and `VIDEO_PROXY_THREADS` cores. Unset, it is `2` when a hardware encoder was found |
| `VIDEO_PROXY_THREADS`         | `2` (1–16)               | Encoder threads of one copy. Copies run at a lower priority (`nice 10`) than the web role                                                                                                                             |
| `VIDEO_PROXY_HWACCEL`         | `auto`                   | Hardware encoding of the copies: `auto`, `nvenc`, `qsv`, `vaapi` or `none` (libx264 only). See [Hardware video encoding](#hardware-video-encoding)                                                                    |
| `VIDEO_PROXY_VAAPI_DEVICE`    | `/dev/dri/renderD128`    | Render node used by `qsv` and `vaapi`                                                                                                                                                                                 |

For custom images or non-Docker installs, tools are discovered on `PATH`. Override individual
paths with `FFMPEG_PATH`, `FFPROBE_PATH`, `EXIFTOOL_PATH`, `PDFTOPPM_PATH`, `PDFINFO_PATH`,
`PRLIMIT_PATH` or `NICE_PATH`. A missing tool disables the previews that need it.

### Hardware video encoding

With the standard image, the worker can make playable copies on a GPU instead of the CPU:
NVIDIA cards with **NVENC**, Intel GPUs (integrated ones too, such as the N100) with **Quick
Sync** (`qsv`) or **VAAPI**, and AMD GPUs with **VAAPI**. When the worker starts, `auto` tries
NVENC, then Quick Sync, then VAAPI: each needs its encoder in ffmpeg, the device, and a
one-second test encode that works. The first that passes is used, and the log says which
(`video encoding: Intel Quick Sync (Intel, /dev/dri/renderD128, low power)`), as does
**Settings → Video**. Naming one backend tries only that one; if it
does not work the worker falls back to libx264 and the Video page shows the selected encoder.

The copy is the same whatever encodes it: H.264 High and AAC in an MP4, the shorter side at
most `VIDEO_PROXY_RESOLUTION`, a keyframe every two seconds, a constant quality under a peak
rate set by the quality preset ([decision 0128](../decisions/0128-video-renditions.md)), and the
same length, size and time limits. GPUs and drivers that refuse the full rate control (QVBR,
lookahead) get plain VBR at the preset's target: the encoder label then says _basic rate control_. H.264, HEVC, VP9 and AV1 in 8-bit 4:2:0 (10-bit for HEVC, VP9 and AV1) are also
decoded and scaled on the GPU; ProRes, DNxHD and 4:2:2 sources are decoded on the CPU and only
encoded on the GPU. **If the GPU fails on a file** (a profile it does not take, a busy device),
that copy is made again with libx264: a video never ends up without its copy because of the GPU.
Whenever the CPU decodes the source, whatever encodes it, ffmpeg keeps the 4 GiB
address-space cap of software copies. When the GPU decodes, VAAPI and Quick Sync, which map GPU
surfaces into the process, get 8 GiB, and NVENC 64 GiB (CUDA reserves much more virtual memory
than it uses): bound what it really uses with a `mem_limit` on the container. The worker also
tests the GPU decode when it starts, on a short H.264 clip; if that fails it decodes on the CPU
for its whole life (`CPU decode` in the label), so no file pays a failed GPU decode first. All
attempts of one copy, fallbacks included, share its time limit (at most 4 hours).

**Intel and AMD (`/dev/dri`).** Pass only the render node to the container, at the path
`VIDEO_PROXY_VAAPI_DEVICE` names (the two must match), and give it the group that owns the node
on the host (`stat -c %g /dev/dri/renderD128`), with
[`deploy/compose.vaapi.yaml`](../../deploy/compose.vaapi.yaml). Add only the group that owns
`/dev/dri/renderD*`: never `disk`, `docker` or any group that gives more than the GPU.

```sh
echo RENDER_GID=$(stat -c %g /dev/dri/renderD128) >> .env
docker compose -f compose.yaml -f deploy/compose.vaapi.yaml up -d
```

```yaml
services:
  inkadra: # `worker` in split mode
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128 # same path as VIDEO_PROXY_VAAPI_DEVICE
    group_add:
      - "${RENDER_GID}" # the group that owns /dev/dri/renderD128 on the host, nothing else
    environment:
      VIDEO_PROXY_HWACCEL: auto # or qsv / vaapi
      VIDEO_PROXY_VAAPI_DEVICE: /dev/dri/renderD128
```

The image has Intel's media driver and the oneVPL runtime of Quick Sync (amd64) and Mesa's
VAAPI drivers for AMD, all from Debian main. Intel's free driver only has the low-power encoder
(VDEnc, Gen 9 and later, including Alder Lake-N): the worker tries it when the normal one
fails. Older Intel GPUs (before Broadwell) are not supported. `docker compose exec inkadra
vainfo --display drm --device /dev/dri/renderD128` lists what the driver offers.

**NVIDIA.** Install the driver and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
on the host, then use [`deploy/compose.nvidia.yaml`](../../deploy/compose.nvidia.yaml):

```yaml
services:
  inkadra: # `worker` in split mode
    mem_limit: 8g # bounds what NVENC copies really use (see above)
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video, compute, utility]
    environment:
      NVIDIA_DRIVER_CAPABILITIES: compute,video,utility
      VIDEO_PROXY_HWACCEL: auto # or nvenc
```

On older Docker versions, `runtime: nvidia` with `NVIDIA_VISIBLE_DEVICES: all` does the same.
The driver can limit concurrent NVENC sessions. Count other programs using the card when
setting `VIDEO_PROXY_CONCURRENCY`.

**Checking it.** After starting the stack:

1. the worker log has `video encoding: …` with the backend, not `Software (libx264)`;
2. Settings → Video shows the selected encoder;
3. upload a ProRes or HEVC clip: the copy is made, and `nvidia-smi` (NVIDIA) or
   `intel_gpu_top` (Intel, on the host) shows the encoder busy meanwhile;
4. the worker log has no `hardware encoding failed` for it (which would mean libx264 made it).

## Maps

Map cards and GPX files show a map picture. The server makes it once, when someone pastes a map
link, types an address or uploads a GPX file: it fetches the tiles around the place from the tile
server and stores the composite as a picture of the project. Browsers, guests and exports only
load that picture, never the tile server. "Explore" on a map card pans and zooms it with tiles
that the server fetches on the person's behalf, through the same queue and cache. See
[decision 0053](../decisions/0053-maps.md).

| Variable                         | Default                                          | Meaning                                                                                                      |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `MAPS`                           | `true`                                           | `false`: map cards show only the place name, address and link, and GPX files only their route line           |
| `MAP_TILE_URL`                   | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Tile server, with `{z}`, `{x}` and `{y}`. It may be on your network. No API key is needed for the default    |
| `MAP_TILE_ATTRIBUTION`           | `© OpenStreetMap contributors`                   | Credit of the tiles, shown on every map                                                                      |
| `MAP_GEOCODER_URL`               | empty                                            | A Nominatim-compatible `/search` address to look up typed addresses; empty leaves addresses unlooked         |
| `MAP_SATELLITE_TILE_URL`         | empty                                            | A second tile server, with `{z}`, `{x}` and `{y}`, for satellite views; empty hides the Map/Satellite switch |
| `MAP_SATELLITE_TILE_ATTRIBUTION` | `Satellite`                                      | Credit of the satellite tiles, shown while they are on screen                                                |

The OpenStreetMap tile servers are run by volunteers: their
[usage policy](https://operations.osmfoundation.org/policies/tiles/) allows a few maps added by
hand, which is what Inkadra does (about twenty tiles a map, with the instance's address in the
user agent), and exploring a map asks for a few dozen more. An instance that makes or explores
many maps should use a tile provider or its own tile server.
With `MAP_SATELLITE_TILE_URL` set, map cards and GPX files get a Map/Satellite switch, for the
card picture and while exploring. Satellite tiles go through the same proxy, queue, cache and
limits (`/api/v1/map-tiles/{z}/{x}/{y}?layer=satellite`, and the guest equivalent): the address
and any key in it stay on the server, and browsers never contact the provider. The switch is
per person and per view; it does not change the board. Use a provider whose licence and usage
policy allow your deployment, and set the credit it requires.
With a geocoder configured, typing at least three characters requests up to five address
suggestions after a short pause. Queries go through Inkadra to that provider; no picture is
created until a result is chosen. Leave the setting empty to keep address queries private and
use map links instead. Choose a provider that permits autocomplete: the
[public Nominatim service](https://operations.osmfoundation.org/policies/nominatim/) prohibits
autocomplete (Inkadra rejects suggestion requests to that host), so use a self-hosted
Nominatim instance or a compatible provider whose policy permits it.

## Compose only

These change `compose.yaml` itself, not the server.

| Variable                  | Default                   | Meaning                                                                        |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `INKADRA_TAG`             | `latest`                  | Image tag: a version such as `0.9.0` (recommended), `latest` or `edge`         |
| `INKADRA_IMAGE`           | `ghcr.io/inkadra/inkadra` | Image name, for a mirror or your own build                                     |
| `INKADRA_PORT`            | `3000`                    | Host port of the web app                                                       |
| `INKADRA_COLLAB_PORT`     | `3001`                    | Host port of `collab`, in split mode                                           |
| `INKADRA_BIND`            | `127.0.0.1`               | Host address the ports listen on. `0.0.0.0` if the proxy is on another machine |
| `INKADRA_DATA`            | volume `inkadra-data`     | Host folder for uploads instead of the volume. See [Storage][data-disks]       |
| `POSTGRES_PASSWORD`       | required                  | Password of the bundled Postgres                                               |
| `POSTGRES_DATA`           | volume `postgres-data`    | Host folder for the database (or the name of another volume)                   |
| `VALKEY_PASSWORD`         |                           | Password of the bundled Valkey, letters and digits (`openssl rand -hex 32`)    |
| `POSTGRES_MAJOR`          | `16`                      | PostgreSQL version, only with `deploy/compose.postgres-old-layout.yaml`        |
| `VALKEY_DATA`             | volume `valkey-data`      | Host folder for Valkey. See [Storage][data-disks]                              |
| `RUSTFS_DATA`             | volume `rustfs-data`      | Host folder for the bundled RustFS                                             |
| `INKADRA_DOMAIN`          |                           | Host of `PUBLIC_URL`, for the bundled proxies                                  |
| `INKADRA_COLLAB_UPSTREAM` | `inkadra:3000`            | Where the bundled Caddy and Nginx send `/collab`: `collab:3001` in split mode  |
| `ACME_EMAIL`              |                           | Contact for Let's Encrypt, for the bundled Traefik                             |
| `TRAEFIK_CERTRESOLVER`    | `letsencrypt`             | Which Traefik certresolver gets the certificate, for the bundled Traefik       |
| `NGINX_CERTS`             | `./certs`                 | Folder with `fullchain.pem` and `privkey.pem`, for the bundled Nginx           |

[data-disks]: storage.md#data-on-different-disks

## Sign-in and email

Setup instructions are in [Sign-in](sign-in.md). Leave unused providers unset. Set Google
client id and secret together; OIDC needs discovery URL, client id and secret together.
`SMTP_URL` requires `MAIL_FROM`.

| Variable                 | Default                | Meaning                                                                           |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`       |                        | OAuth client of type "Web application" in Google Cloud. Shows the Google button   |
| `GOOGLE_CLIENT_SECRET`   |                        | Its secret                                                                        |
| `GOOGLE_ALLOWED_DOMAINS` | any                    | Comma-separated Google Workspace domains that may sign in, e.g. `studio.it`       |
| `OIDC_NAME`              | `SSO`                  | Label of the button of your OpenID Connect provider                               |
| `OIDC_DISCOVERY_URL`     |                        | Its `.well-known/openid-configuration` address                                    |
| `OIDC_CLIENT_ID`         |                        | Client id given by the provider                                                   |
| `OIDC_CLIENT_SECRET`     |                        | Client secret given by the provider                                               |
| `OIDC_SCOPES`            | `openid email profile` | Scopes to ask for                                                                 |
| `OIDC_TRUST_EMAIL`       | `false`                | `true` links OIDC sign-ins to existing accounts with the same email               |
| `OIDC_ALLOWED_DOMAINS`   | any                    | Comma-separated email domains whose verified OIDC accounts may sign in            |
| `SMTP_URL`               |                        | `smtp://user:password@host:587` or `smtps://…:465`. Turns on email                |
| `MAIL_FROM`              |                        | Sender, e.g. `Inkadra <inkadra@example.com>`. Required with `SMTP_URL`            |
| `CLIPPER_EXTENSION_IDS`  |                        | Ids of self-built browser clippers allowed to sign in. The official one always is |

Allowed domains are checked on every sign-in, also for people who already have an account:

- **Google** checks the `hd` claim, the Workspace domain Google itself vouches for. A personal
  `@gmail.com` account has no `hd`, so with `GOOGLE_ALLOWED_DOMAINS` set it cannot sign in,
  even if it was linked before.
- **OIDC** checks the domain of the email address, and only accepts it when the provider marks
  it verified (`email_verified` set to `true`, or the string `"true"`). Without
  `OIDC_ALLOWED_DOMAINS` there is no domain check. If `OIDC_DISCOVERY_URL` points at Google
  (`accounts.google.com`), the `hd` claim is checked instead, against `OIDC_ALLOWED_DOMAINS` or,
  when that is empty, `GOOGLE_ALLOWED_DOMAINS`.

## TRUST_PROXY

**LAN port exposure requires narrowing the default trust list.** See the warning in
[Direct LAN and Tailscale access](#direct-lan-and-tailscale-access) before publishing a port.

Behind a proxy, every request reaches Inkadra from the proxy's address. The proxy puts the
real client address in `X-Forwarded-For`, and Inkadra believes that header only when the
request comes from an address listed in `TRUST_PROXY`. The client address limits sign-in
attempts and appears in the logs, so a wrong value either blocks everyone at once (the proxy
looks like one client) or lets anyone fake an address.

The value is `false`, or a comma-separated list of addresses, CIDR ranges and the presets
`loopback`, `linklocal` and `uniquelocal` (private networks). Without a value Inkadra trusts
loopback and every private network, which works for a proxy on the same machine or in the same
Docker network. It is a starting point, not the safest setting: anything else on those networks
could claim any client address. Set it to **the proxy's own address**:

- a bundled proxy (`deploy/proxy/*`): nothing to do. It runs at a fixed address,
  `10.212.47.2`, and its compose file sets `TRUST_PROXY` to it unless `.env` sets another value.
  In split mode with Caddy or Nginx, the `collab` container keeps the general value;
- a proxy in the same Docker network: its single container IP, e.g.
  `TRUST_PROXY=172.18.0.10`. Pin it with `ipv4_address: 172.18.0.10` in compose
  (and configure network IPAM for that address);
- a proxy on the same machine, reaching the published port: verify the peer Inkadra actually
  sees. Docker may translate it; do not assume it is loopback or trust the Docker gateway;
- a proxy on another machine of your LAN: its address, e.g. `TRUST_PROXY=192.168.1.10`;
- a proxy that reaches Inkadra over Tailscale, for example Pangolin on a VPS targeting the
  server's Tailscale address: only that proxy's tailnet address, e.g.
  `TRUST_PROXY=100.100.10.20`, not the whole `100.64.0.0/10` range.

Never use `true`: it trusts everyone, so any client could choose its address.

## Sign-in limits

Inkadra limits sign-in, sign-up, password reset, email links and two-factor attempts per
client network, per account and per email recipient. The counters live in Valkey (`REDIS_URL`),
so they hold across restarts and across containers in split mode.

- **`REDIS_URL` is required in production by every role**, `web` included: without it the
  server does not start. `compose.yaml` sets it to the bundled Valkey.
- If Valkey is unreachable, the endpoints above answer `503` instead of letting attempts through;
  people who are already signed in stay signed in and can sign out.
- After a successful sign-in over HTTPS, the browser gets a signed _known device_ cookie valid 90
  days. When an account is locked because of too many failed attempts, a known device can still
  try, within its own budget (five failures in 15 minutes). The cookie never skips the password
  or the second factor. Changing `AUTH_SECRET` invalidates every one.
- `AUTH_RATE_LIMITS=off` turns the limits off, for isolated end-to-end tests only: it is ignored
  when `NODE_ENV=production`, which is the image's default.

### Unlocking an account

If someone is locked out by failed attempts and cannot wait for the counters to expire, an
administrator of the server (not of the app: there is no web page for this) can clear them:

```sh
docker compose exec inkadra node /app/dist/main.js unlock-auth person@example.com
# also clear that address's counters for one client network:
docker compose exec inkadra node /app/dist/main.js unlock-auth person@example.com 192.0.2.10
```

It clears the account and email counters of that address in this instance's Valkey. It does not
change the password, sessions or two-factor settings, and it does not lift the per-network limits
of other addresses.

## Browser security headers

Inkadra sends `Content-Security-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin` and, over HTTPS, `Strict-Transport-Security` on its
pages. Each of the two variables below is an off switch, for a setup that a header breaks:

| Variable         | Default | Meaning                                                                                                                                                                                      |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSP_ENFORCE`    | `true`  | `true` enforces the policy; `false` sends it as `Content-Security-Policy-Report-Only`, so the browser only reports what it would block                                                       |
| `CSP_REPORT_URI` |         | Absolute address that receives violation reports, e.g. `https://reports.example.com/csp`                                                                                                     |
| `HSTS_ENABLED`   | `true`  | Sends `Strict-Transport-Security: max-age=31536000` when `PUBLIC_URL` is https, only on requests whose verified transport is HTTPS (never on a plain-HTTP LAN address). `false` turns it off |

The policy allows the instance itself, its WebSocket, the S3 bucket when files are in S3,
Google profile pictures and the privacy-enhanced YouTube player. If something you use is
blocked, the browser's console says `Refused to load…`: set `CSP_ENFORCE=false`, run
`docker compose up -d`, and please open an issue; see also
[Upgrades](upgrades.md#trying-csp-enforcement).

HSTS tells browsers to use only HTTPS for the host name of `PUBLIC_URL` (and any other host
name the instance answers over HTTPS) for a year. If you also reach Inkadra over plain HTTP **on
the same host name** (for example a different port), set `HSTS_ENABLED=false`: other host names
and IP addresses, such as a LAN or Tailscale address, are not affected. The proxy can send
HSTS too: see [Reverse proxy](reverse-proxy.md#security-headers).

## Personal tokens and second factor

- With two-factor authentication on, every way of signing in asks for the second factor: password,
  email link, Google and OIDC.
- Creating a personal token or authorizing an app needs a session younger than 15 minutes: sign
  in again if it is older.
- Personal tokens expire after 90 days unless a lifetime is chosen (at most 3650 days). Changing
  the password revokes personal tokens but not app tokens; a password reset revokes every token
  and signs out every browser.
- Email is sent in the background: a container stopped at the wrong moment can lose a message
  that was about to go out, and failures are logged without credentials.

## Direct LAN and Tailscale access

`PUBLIC_URL` is the canonical external address for email, invitations, share links and
OAuth callbacks. You can also use any directly reachable LAN or Tailscale HTTP address
without registering it. Cookies follow the verified request protocol: Secure host cookies
on HTTPS, ordinary host-only cookies on HTTP. Sign in separately at each hostname.

`INKADRA_BIND=0.0.0.0` publishes the configured port on every host interface, including the
LAN. Restrict it with a firewall; do not expose plain HTTP to the public internet. HTTP
exposes passwords, sessions and content in clear text. Tailscale encrypts traffic between
peers. Narrow `TRUST_PROXY` to actual proxy peers: it controls trust in forwarded host and
protocol as well as client addresses. Direct clients do not need to be trusted proxies.

HTTP cookies ignore ports. Use a hostname dedicated to Inkadra for direct HTTP access:
another service on the same IP/hostname can receive or plant `inkadra.session_token` or
`inkadra.invitation`, including a more specific Path, enabling fixation/login CSRF without
cross-origin requests. Alternatively use HTTPS through `tailscale serve`.

Do not trust the whole Docker subnet or its gateway. With userland-proxy, hairpin,
rootless Docker or IPv6 forwarding, a direct LAN client can appear as the Docker gateway
(e.g. `172.18.0.1`). Trusting that gateway/subnet lets direct clients forge proxy headers.
Use the pinned proxy container IP and verify the peer address in your deployment.

## In-app reports

Reporting to the **Inkadra developers is on without a saved choice**, also on an upgraded instance,
via the relay described below. What leaves and how to turn it off, in plain words:
[What leaves your server](README.md#what-leaves-your-server).
Saved administrator choices override that default. In Settings → Reports an administrator
chooses Inkadra developers, own GitHub, Inbox only or Off, the destination `owner/repository`, whether
guests may report (off by default) and how long attachments are kept (90 days by default; 30
days or one year on request). Every report is first saved in the local database; attachments
use the configured instance storage (`STORAGE_DRIVER`, `DATA_DIR` or the existing `S3_*`
variables). Include both in backups.

| Environment variable    | Purpose                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEEDBACK_GITHUB_TOKEN` | Server-only fine-grained GitHub token. Unset/empty by default. Never sent to the browser, logged or displayed in Settings.                                     |
| `PUBLIC_URL`            | Existing canonical instance URL, used for attachment links. It must be reachable by people opening links and by GitHub's image proxy for embedded screenshots. |

`FEEDBACK_RELAY_URL` controls the developer relay (see below). Destination, repository, guest policy and
retention are administrator settings.

**The direct-path token.** A fine-grained personal access token, ideally of a service account: issues show
that account as their author. Restrict it to **one selected private repository**, with
**Issues: read and write** and the automatically required **Metadata: read**. Contents is not
needed: nothing is committed to GitHub. Do not choose the public application repository.

**The repository** needs the labels `bug`, `idea`, `question`, `from-app` and `area:home`,
`area:board`, `area:settings`, `area:guest`, `area:other`. Create them beforehand: whether GitHub
creates a missing label for an Issues-only token is not guaranteed. Private visibility is checked
when the setting is saved and before every delivery; a failed check keeps the report local.
With destination GitHub and no token yet, reports wait locally and are delivered once the token
is set. Existing direct GitHub installations retain their chosen destination.

**Limits.** Members can submit fifteen reports/hour and guests two; the instance limit is 100/hour.
Members may attach one screenshot, five files up to 25 MB each, and one video up to 100 MB.
Guests may send text (description up to 4,000 characters), one screenshot up to 5 MB, environment
and sanitized page information. Types are sniffed from the bytes: images, videos, PDF and plain
text only; nothing but screenshots is served inline. Screenshots and PNG, JPEG and WebP files are
rewritten without metadata (GPS included), up to 40 megapixels; HEIC and other formats leave as
they came. Uploads go through a temporary file in `DATA_DIR/tmp`, not memory.
Report text goes into the issue with mentions, references, links and markup neutralised.

**Direct-path attachment links** are random bearer credentials: **anyone holding a link can open it until
it expires**, without an Inkadra or GitHub login. Expired links stop working immediately; a
maintenance sweep removes the files within about one minute. Unsubmitted uploads expire after 24
hours. Do not post these links publicly. Screenshots inside private GitHub issues depend on the
instance being reachable; whether GitHub shows them is unverified.

**Delivery.** When GitHub answers 429, 403 or cannot be reached before the write, the report
retries with exponential backoff and the person has already seen "sent", with a local reference.
A lost connection or a 5xx during the write itself leaves the outcome unknown: the report is
marked "To check on GitHub" and not posted again, to prevent duplicates. A 401, 404, 410, 422 or a
repository that is no longer private stops the retries: the reason is logged and shown in
Settings → Reports, and **Try again** there sends those reports round again. A report still
retrying reads "Waiting to be sent", and **Try again** in its expanded row runs the same delivery
sooner, with no risk of a duplicate. If the destination changes, queued reports stay local, marked
"Inbox only", and never go to the repository chosen before.
Offline drafts are never sent in the background: text stays in the browser and leaves only after
the preview and a manual send. Videos stay in tab memory.

### Reports to the Inkadra developers

`FEEDBACK_RELAY_URL` defaults to `https://relay.inkadra.com`. Set it to
another `https://` relay URL to override (plain `http://` only to this machine), or to the empty
string to disable this route. No GitHub or Cloudflare credential is installed in the app for it.

**Every instance without a saved choice uses this destination, including one upgraded from an
earlier version where reporting was off.** To keep reports off, save a choice in Settings → Reports
or set the empty value before upgrading. Guests stay disabled. Settings lets administrators turn
developer reporting off with one switch (Inbox), choose Inbox only, disable reports, or configure
their own private GitHub repository. Saved administrator choices always take precedence, including
existing direct GitHub setups. A dialog opened before the choice changed asks to read it again.

For report contents, redaction, metadata and attachment retention, see
[What leaves your server](README.md#what-leaves-your-server). PDFs retain their metadata.
Device videos need ffmpeg for metadata removal; the dialog refuses them without it.

**Limits.** 10 MiB per image or file, 25 MiB per video, 32 MiB per report; direct GitHub keeps its
100 MiB video limit. The relay accepts 20 reports (64 MiB of files) a day per network and 200 a day in total, across
every instance that uses it: beyond that, reports wait in the local queue and leave by themselves. During an outage they wait too, and
Settings says so. If the relay gives no answer to a write, the report is marked as not confirmed:
trying again from Settings is safe, because the relay recognises a report it already has. GitHub
attachments live on `feedback-assets` and are not removed by the local retention setting.

## Rotating the authentication secret

Set `AUTH_SECRET_PREVIOUS` to the old `AUTH_SECRET`, replace `AUTH_SECRET` with a new random
value of at least 32 characters, and restart every Inkadra role with the same pair of values.
Keep both values private. Session cookies and known-device cookies still use only the current
secret: this signs everyone out. Calendar feeds must be regenerated.

New sealed values use the current secret. The previous secret only keeps existing invitation
and share-link tokens, app token proofs, two-factor secrets and recovery codes readable.
There is no automatic rewrite of stored values. Keep `AUTH_SECRET_PREVIOUS` until all values
written with it have expired, been revoked or been replaced, including two-factor enrollment
and app proof keys, which may otherwise live indefinitely. Removing it sooner makes those old
values unreadable. Only one previous secret is supported: complete that replacement before
rotating again. After a suspected compromise, revoke or replace affected credentials rather
than relying on retaining the compromised secret.
