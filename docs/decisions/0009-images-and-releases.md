# 0009 · How images are built, checked and released

Accepted, 2026-10. Extends [0002](0002-one-image-several-roles.md).

**Context.** People run Inkadra on VPSs, home servers and NAS boxes, on amd64 and arm64, behind
proxies we do not control. The image is the product they install, so it has to be small,
locked down, verifiable, and proven to work behind the common proxies before it ships.

**Decision.**
- **Runtime.** Debian slim with Node 22, `tini` as PID 1, user `node` (uid 1000). npm, corepack
  and yarn are removed. Compose runs it with a read-only root filesystem, no capabilities and
  `no-new-privileges`; it writes only to `/data`, and `TMPDIR` points at `/data/tmp` because
  upload parts can be larger than a RAM-backed `/tmp`. One health check script serves every
  role, reading the role from the main process's arguments.
- **Production dependencies only.** `.pnpmfile.cjs` drops the optional peers that Better Auth
  declares (React, Vite, Vitest, drizzle-kit…): without it pnpm linked them from the workspace
  into the server's production install, which more than doubled `node_modules`.
- **Compose files.** `compose.yaml` stays the single-file, all-in-one install. Everything else is
  an overlay in `deploy/` added with `-f`: split mode, S3, bundled RustFS, and one folder per
  reverse proxy. Overlays use `extends`, `!reset` and `!override` so they never repeat the base
  settings. Paths inside them are relative to the folder of `compose.yaml`.
- **Bundled object store: RustFS.** MinIO stopped publishing container images, so the bundled
  S3 option uses RustFS (Apache-2.0, same API). Any S3-compatible service works through
  `deploy/compose.s3.yaml`.
- **Proxies are tested, not just documented.** CI starts the built image behind Caddy, Traefik
  and Nginx, in all-in-one and split mode, and checks the redirect, forwarded headers, secure
  cookies, WebSocket upgrade, large bodies and resumable uploads (`scripts/test-proxy.sh`).
- **Supply chain.** Actions are pinned to commits and tools to checksums; `actionlint` and
  `zizmor` lint the workflows; gitleaks scans the whole history; grype fails the build on
  critical vulnerabilities that have a fix. Published images are built per architecture on
  native runners (no emulation), without build cache, with an SBOM and BuildKit provenance, then
  joined into one multi-architecture tag and given a GitHub build provenance attestation
  (`gh attestation verify`).
- **Releases.** A `vX.Y.Z` tag on `main` publishes `X.Y.Z`, `X.Y` and `latest` and creates the
  GitHub release with the deployment files pinned to that version; a `-suffix` tag is a
  pre-release. `main` publishes `edge`.

**Consequences.** A release takes longer (no cache, two native builds) but is reproducible from
a clean state and checkable by anyone. Adding a system package to the image (ffmpeg, fonts)
goes through the Dockerfile and shows up in the scan. A proxy example that breaks fails CI,
so the documentation cannot drift from what works.
