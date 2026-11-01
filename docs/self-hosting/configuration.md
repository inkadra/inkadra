# Configuration

Inkadra reads its settings from the environment. With Compose, put them in `.env` next to
`compose.yaml`; [`.env.example`](../../.env.example) lists them with their defaults. Never commit
or share the real `.env`.

## Server

| Variable        | Default                          | Meaning                                                                                          |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_ENV`      | `production`                     | `development`, `production` or `test`                                                            |
| `PUBLIC_URL`    | required                         | Address people use, as served by your proxy, e.g. `https://inkadra.example.com`. No path         |
| `AUTH_SECRET`   | required                         | At least 32 random characters: `openssl rand -hex 32`. Changing it signs everyone out            |
| `DATABASE_URL`  | set by compose                   | Postgres connection string                                                                       |
| `REDIS_URL`     | set by compose                   | Valkey or Redis connection string. Required in production by `web`, `worker`, `all` and `collab` |
| `INSTANCE_NAME` | `Inkadra`                        | Name shown in the app                                                                            |
| `REGISTRATION`  | `invite`                         | `invite`: only invited people can sign up. `open`: anyone can                                    |
| `HOST`          | `0.0.0.0`                        | Interface the web server listens on                                                              |
| `PORT`          | `3000`                           | Port of the web server                                                                           |
| `COLLAB_PORT`   | `3001`                           | Port of the collaboration server, in split mode                                                  |
| `DATA_DIR`      | `/data`                          | Where files live; the `local` driver keeps them in `<DATA_DIR>/files`                            |
| `WEB_DIST`      |                                  | Folder of the built web app; unset for the default next to the server                            |
| `TRUST_PROXY`   | `loopback,linklocal,uniquelocal` | Who may tell Inkadra the client's address. See [below](#trust_proxy)                             |
| `LOG_LEVEL`     | `info`                           | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                             |

## Files and uploads

| Variable               | Default     | Meaning                                                                                           |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`       | `local`     | `local`: files in the data volume. `s3`: files in a bucket. See [Storage](storage.md)             |
| `S3_ENDPOINT`          | AWS         | Address of an S3-compatible service, e.g. `https://s3.eu-central-003.backblazeb2.com`             |
| `S3_REGION`            | `us-east-1` | Region of the bucket                                                                              |
| `S3_BUCKET`            |             | Bucket name                                                                                       |
| `S3_ACCESS_KEY_ID`     |             | Access key                                                                                        |
| `S3_SECRET_ACCESS_KEY` |             | Secret key                                                                                        |
| `S3_FORCE_PATH_STYLE`  | `false`     | `true` for MinIO, RustFS, Garage and most self-hosted stores                                      |
| `UPLOAD_MAX_SIZE`      | `20GB`      | Largest file anyone can upload, as bytes or with a unit (`500MB`, `4GB`); `0` for no limit        |
| `IMPORT_MAX_SIZE`      | `20GB`      | Largest project archive an import accepts, compressed and in total uncompressed; `0` for no limit |
| `HEIC_PREVIEWS`        | `true`      | `false` stops Inkadra decoding HEIC photos from iPhones: they are kept, without a preview         |

## Media previews

These need the `-media` image (see [The image](README.md#the-image)); the standard image has no
media tools and ignores them. The policy is in [decision 0048](../decisions/0048-media-worker-previews.md).

| Variable                      | Default               | Meaning                                                                                                                                                                                                               |
| ----------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAW_PREVIEWS`                | `true`                | Thumbnails of camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2) from the JPEG preview the camera embedded                                                                                                     |
| `PDF_PREVIEWS`                | `true`                | Thumbnails of page 1 of PDFs and their page count, rendered once on upload                                                                                                                                            |
| `VIDEO_PROXIES`               | `true`                | Make a playable H.264/AAC MP4 of videos browsers cannot play (ProRes, MKV, AVI, MXF, HEVC). `false` saves the storage                                                                                                 |
| `VIDEO_PROXY_MAX_DURATION`    | `7200`                | Longest video, in seconds, that gets a playable copy; `0` for no limit                                                                                                                                                |
| `VIDEO_PROXY_MAX_SOURCE_SIZE` | `20GB`                | Largest video that gets a playable copy, as bytes or with a unit; `0` for no limit                                                                                                                                    |
| `VIDEO_PROXY_RESOLUTION`      | `1080`                | Shorter side of the copy in pixels (`1080` gives 1920×1080 at most); never upscaled                                                                                                                                   |
| `VIDEO_PROXY_BITRATE`         | `5M`                  | Peak video bitrate of the copy (`5M`, `2500k`); about 40 MB per minute at `5M`                                                                                                                                        |
| `VIDEO_PROXY_CONCURRENCY`     | `1`, `2` with a GPU   | Copies one worker makes at once, at most `4`. Count 1 to 2 GB of RAM per copy at 1080p (each is capped at 4 GiB of address space) and `VIDEO_PROXY_THREADS` cores. Unset, it is `2` when a hardware encoder was found |
| `VIDEO_PROXY_THREADS`         | `2`                   | Encoder threads of one copy. Copies run at a lower priority (`nice 10`) than the web role                                                                                                                             |
| `VIDEO_PROXY_HWACCEL`         | `auto`                | Hardware encoding of the copies: `auto`, `nvenc`, `qsv`, `vaapi` or `none` (libx264 only). See [Hardware video encoding](#hardware-video-encoding)                                                                    |
| `VIDEO_PROXY_VAAPI_DEVICE`    | `/dev/dri/renderD128` | Render node used by `qsv` and `vaapi`                                                                                                                                                                                 |

### Hardware video encoding

With the `-media` image, the worker can make playable copies on a GPU instead of the CPU:
NVIDIA cards with **NVENC**, Intel GPUs (integrated ones too, such as the N100) with **Quick
Sync** (`qsv`) or **VAAPI**, and AMD GPUs with **VAAPI**. When the worker starts, `auto` tries
NVENC, then Quick Sync, then VAAPI: each needs its encoder in ffmpeg, the device, and a
one-second test encode that works. The first that passes is used, and the log says which
(`video encoding: Intel Quick Sync (Intel, /dev/dri/renderD128, low power)`), as does
**Settings → Diagnostics** (_Video encoding_). Naming one backend tries only that one; if it
does not work the worker falls back to libx264 and Diagnostics shows a warning.

The copy is the same whatever encodes it: H.264 High and AAC in an MP4, the shorter side at
most `VIDEO_PROXY_RESOLUTION`, `VIDEO_PROXY_BITRATE` at peak, and the same length, size and
time limits. H.264, HEVC, VP9 and AV1 in 8-bit 4:2:0 (10-bit for HEVC, VP9 and AV1) are also
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
Consumer GeForce cards allow a limited number of NVENC sessions at once (8 with current drivers,
fewer with old ones): keep `VIDEO_PROXY_CONCURRENCY` under it, counting other programs (Plex,
Jellyfin) that use the card.

**Checking it.** After starting the stack:

1. the worker log has `video encoding: …` with the backend, not `Software (libx264)`;
2. Settings → Diagnostics shows the same under _Video encoding_;
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

| Variable               | Default                                          | Meaning                                                                                                   |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `MAPS`                 | `true`                                           | `false`: map cards show only the place name, address and link, and GPX files only their route line        |
| `MAP_TILE_URL`         | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Tile server, with `{z}`, `{x}` and `{y}`. It may be on your network. No API key is needed for the default |
| `MAP_TILE_ATTRIBUTION` | `© OpenStreetMap contributors`                   | Credit of the tiles, shown on every map                                                                   |
| `MAP_GEOCODER_URL`     | empty                                            | A Nominatim-compatible `/search` address to look up typed addresses; empty leaves addresses unlooked      |

The OpenStreetMap tile servers are run by volunteers: their
[usage policy](https://operations.osmfoundation.org/policies/tiles/) allows a few maps added by
hand, which is what Inkadra does (about twenty tiles a map, with the instance's address in the
user agent), and exploring a map asks for a few dozen more. An instance that makes or explores
many maps should use a tile provider or its own tile server.
The same goes for `https://nominatim.openstreetmap.org/search` as a geocoder (at most one search
a second).

## Compose only

These change `compose.yaml` itself, not the server.

| Variable                  | Default                   | Meaning                                                                        |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `INKADRA_TAG`             | `latest`                  | Image tag: a version such as `0.4.0` (recommended), `latest` or `edge`         |
| `INKADRA_IMAGE`           | `ghcr.io/inkadra/inkadra` | Image name, for a mirror or your own build                                     |
| `INKADRA_PORT`            | `3000`                    | Host port of the web app                                                       |
| `INKADRA_COLLAB_PORT`     | `3001`                    | Host port of `collab`, in split mode                                           |
| `INKADRA_BIND`            | `127.0.0.1`               | Host address the ports listen on. `0.0.0.0` if the proxy is on another machine |
| `INKADRA_DATA`            | volume `inkadra-data`     | Host folder for uploads instead of the volume                                  |
| `POSTGRES_PASSWORD`       | required                  | Password of the bundled Postgres                                               |
| `POSTGRES_DATA`           | volume `postgres-data`    | Host folder for the database (or the name of another volume)                   |
| `POSTGRES_MAJOR`          | `16`                      | PostgreSQL version, only with `deploy/compose.postgres-old-layout.yaml`        |
| `VALKEY_DATA`             | volume `valkey-data`      | Host folder for Valkey                                                         |
| `RUSTFS_DATA`             | volume `rustfs-data`      | Host folder for the bundled RustFS                                             |
| `INKADRA_DOMAIN`          |                           | Host of `PUBLIC_URL`, for the bundled proxies                                  |
| `INKADRA_COLLAB_UPSTREAM` | `inkadra:3000`            | Where the bundled Caddy and Nginx send `/collab`: `collab:3001` in split mode  |
| `ACME_EMAIL`              |                           | Contact for Let's Encrypt, for the bundled Traefik                             |
| `TRAEFIK_CERTRESOLVER`    | `letsencrypt`             | Which Traefik certresolver gets the certificate, for the bundled Traefik       |
| `NGINX_CERTS`             | `./certs`                 | Folder with `fullchain.pem` and `privkey.pem`, for the bundled Nginx           |

## Sign-in and email

Step by step in [Sign-in](sign-in.md). Every variable is optional.

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
`loopback`, `linklocal` and `uniquelocal` (private networks). The default trusts loopback and
every private network, which works for a proxy on the same machine or in the same Docker
network. It is a starting point, not the safest setting: anything else on those networks could
claim any client address. Once the proxy works, narrow it to **the proxy's own address**:
- a proxy in the same Docker network: its single container IP, e.g.
  `TRUST_PROXY=172.18.0.10`. Pin it with `ipv4_address: 172.18.0.10` in compose
  (and configure network IPAM for that address);
- a proxy on the same machine, reaching the published port: `TRUST_PROXY=loopback`;
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

Inkadra sends `Content-Security-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy: same-origin` on its pages. Two of them are opt-in, because a wrong
setting can break an installation in ways the server cannot see:

| Variable         | Default | Meaning                                                                                                        |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `CSP_ENFORCE`    | `false` | `false` sends the policy as `Content-Security-Policy-Report-Only`; `true` enforces it                          |
| `CSP_REPORT_URI` |         | Absolute address that receives violation reports, e.g. `https://reports.example.com/csp`                       |
| `HSTS_ENABLED`   | `false` | `true` sends `Strict-Transport-Security: max-age=31536000`, only on requests whose verified transport is HTTPS |

The policy allows the instance itself, its WebSocket, the S3 bucket when files are in S3,
Google profile pictures and the privacy-enhanced YouTube player. To move to enforcement, see
[Upgrades](upgrades.md#trying-csp-enforcement). HSTS is usually better set at the proxy, which
also redirects HTTP to HTTPS: see [Reverse proxy](reverse-proxy.md#security-headers).

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

> **Before exposing the port to LAN clients:** narrow `TRUST_PROXY` to the proxy's
> container IP pinned with `ipv4_address`, for example `172.18.0.10`
> or `100.100.10.20` for the Newt peer. The default includes `uniquelocal`, which
> trusts all RFC1918 clients. Such a client can forge `X-Forwarded-Proto: https`,
> `X-Forwarded-Host` and `X-Forwarded-For`, selecting Secure cookies over cleartext
> or bypassing address-based rate limits. Direct clients need no proxy trust.

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
