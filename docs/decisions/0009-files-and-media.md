# 0009 · Files: tus uploads, immutable storage, thumbnails in the worker

Accepted, 2026-10.

**Context.** Film and photo projects bring large files (4 GB videos over hotel Wi-Fi), iPhone
photos in HEIC, and camera metadata that can reveal where someone lives. Installs range from a
single small server with a local disk to S3-compatible buckets.

**Decision.**
- Uploads use tus 1.0 (`@tus/server`) at `/api/v1/uploads`. The creation request also creates
  the asset row, with status `pending`, and the upload id **is** the asset id, so clients know
  it from the first response (`Inkadra-Asset-Id`). Clients send chunks of at most 50 MiB, which
  passes through proxies with a per-request limit such as Cloudflare's 100 MB.
  Unfinished uploads are removed after 24 hours by the `purge-uploads` maintenance job.
- Storage is a local directory (`DATA_DIR/files`) or an S3 bucket, chosen by `STORAGE_DRIVER`.
  Keys are `originals/<assetId>` and `variants/<assetId>/<size>.webp`. Files never change after
  they are written, so they are served with `immutable` caching and deleted only with their
  rows (rows first, files after, through a job).
- The worker (`media:process`) checksums every file and, for images, reads the real type from
  the first bytes, applies the EXIF orientation, extracts dominant colours and writes WebP
  thumbnails 256, 512, 1024 and 2048 px wide, never wider than the original. Thumbnails carry
  no metadata.
- GIFs and animated WebPs also get moving WebP copies of the same thumbnails (up to 1024 px
  wide, 300 frames and 6 MiB in all), at `variants/<assetId>/<size>-animated.webp` and served
  with `?animated=1` on the thumbnail route, or 404 when there is none. They are not rows of
  their own: the poster stays the only variant in `asset_variant`, so clients that do not ask
  for motion keep it, and reduced motion or a large board simply never asks. The caps are on
  the source pixels (frames × frame area, and one frame on its own), because sharp decodes
  every frame at full size before resizing it, whatever width the variants end up at. Anything
  past the caps keeps the poster everywhere. The asset row says `animated`, so clients ask
  for the moving copy only when there is one; a frame that does not decode drops the moving
  copies and leaves the posters, never the asset.
- EXIF is stored from an allow-list of camera and exposure fields; location (GPS) is never
  stored or returned. Originals keep their metadata and are served only to project members;
  guest links (wave 3) must serve thumbnails or a stripped copy.
- HEIC is decoded with `heic-decode` (libheif and libde265 compiled to WebAssembly, LGPL-3.0,
  used unmodified as a separate module), because the prebuilt `sharp` binaries do not include
  HEVC. HEVC is patent-encumbered in some countries, so `HEIC_PREVIEWS=false` keeps HEIC files
  without previews. `libheif-js` is listed as reviewed in `scripts/check-licenses.mjs`.
- Originals are served with a sandbox Content-Security-Policy; only well-known image, video,
  audio and PDF types are shown inline, everything else (HTML, SVG, XML…) is a download.
- Link previews are fetched by the server only over http(s) on default ports, resolving the
  name once and connecting to the checked address, refusing loopback, private, link-local,
  CGNAT and IPv6 ULA ranges on every hop, with at most 3 redirects, 5 seconds and 1 MB per page.

**Consequences.** RAW files and video posters need more codecs (libraw, ffmpeg) and are left for
after 1.0. With S3, tus buffers parts on local disk: `TMPDIR` must point to the data volume.
