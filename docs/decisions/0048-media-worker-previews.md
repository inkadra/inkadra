# 0048 · Media worker previews: playable video copies, camera RAW, PDF pages

Proposed, 2026-10. Extends files and media (decision 0009) and the `-media` image (decision
0010). Part of the file card family (#325); the cards themselves come later, after a mockup.

**Context.** Camera files (ProRes MOV, MKV, AVI, MXF, HEVC) often do not play in the browser.
The worker already reads the duration and a poster frame with ffmpeg, but playback depends on
what the browser happens to decode, and a card that does not play is a dead end. Camera RAW
photos and PDFs had no preview at all. Every one of these is an untrusted binary: it is read
in the worker, by tools of the `-media` image, with time and memory limits, never in the
browser.

**Decision.**
- **Which videos.** After the poster, the worker probes the video with ffprobe. The original
  plays as it is, and nothing is made, when it is H.264 (8-bit 4:2:0) with AAC, MP3 or no sound
  in an MP4, or VP8, VP9 or AV1 with Opus, Vorbis or no sound in a WebM. Every other video
  with a picture gets a **playable copy**. QuickTime is not trusted even with H.264 inside:
  Firefox refuses `video/quicktime`.
- **What is made.** An H.264 (High, `yuv420p`, `veryfast`, CRF 23, capped at
  `VIDEO_PROXY_BITRATE`, 5 Mbit/s by default) and AAC (128 kbit/s, stereo) MP4 with
  `+faststart`, the shorter side at most `VIDEO_PROXY_RESOLUTION` (1080) and never upscaled.
  H.264 that already fits is only remuxed (`-c:v copy`), and AAC sound is copied, so an MKV
  or MOV from a phone takes seconds. Metadata, chapters and subtitles are dropped.
- **Limits.** Sources longer than `VIDEO_PROXY_MAX_DURATION` (2 h) or larger than
  `VIDEO_PROXY_MAX_SOURCE_SIZE` (20 GB) are skipped. Whatever its header claims, the copy
  stops at that length (`-t`) and at a size planned from the peak bitrates (`-fs`, half again
  over the length; the source size for a remux); a video of unknown length is planned for the
  cap, never for nothing, and durations past what an `integer` column holds are discarded.
  ffmpeg gets only the file protocol and a list of demuxers (as for posters), the first video
  stream that is not cover art (`-map 0:V:0`), `VIDEO_PROXY_THREADS` threads (2) at `nice 10`,
  a 4 GiB address space and a file-size cap through `prlimit`, no environment of the server,
  and four times the planned length (at least 10 minutes, at most 4 hours) before it is
  killed. Free space is checked before the source is downloaded from a bucket and before
  ffmpeg starts. Jobs run in their own BullMQ queue, `media-proxies`, one at a time per worker
  (`VIDEO_PROXY_CONCURRENCY`, at most 4), two attempts, none after a timeout; a second pass of
  the asset queues it again. Without Redis they run one after the other in the web process.
- **Scratch files.** Every media job (copies, posters, RAW previews, PDF pages) works in a
  folder of its own, `DATA_DIR/tmp/job-*`, removed when it ends; folders older than 6 hours,
  left by a crash, are swept when the server starts.
- **Storage.** The copy is the `proxy` row of `asset_variant` (`mime`, `bytes`), at
  `variants/<assetId>/proxy.mp4`, so it is removed with the asset like the thumbnails. It is
  never listed with the thumbnails. A second pass of the thumbnails keeps it: originals never
  change. Backups leave copies out, rows and files: they can be made again, and they restore
  as `skipped`. A copy finished for an asset deleted meanwhile is removed. `VIDEO_PROXIES=false` turns copies off for an instance that would rather save the
  storage; the copies already made stay.
- **API.** `Asset.proxy` is null when no copy is needed, else `{ status, progress, url, mime,
  width, height, size }` with `status` one of `queued`, `processing` (with `progress` in
  percent), `ready`, `failed` or `skipped` (turned off, past the limits or no ffmpeg).
  `GET /assets/{id}/proxy` serves it with byte ranges to every role that sees the asset, like
  the stream of an original video. `Asset.videoCodec`, `audioCodec` and `frameRate` come from
  the same probe. `Instance.media.videoProxies` says whether the instance makes copies.
  `Asset.url` stays the untouched original, for "Download original". The viewer plays the copy
  when it is ready; the card design waits for the mockup of #325. Guests play originals for
  now.

**Camera RAW.**
- CR2, CR3, NEF, ARW, DNG, RAF, ORF and RW2 are recognised by their first bytes; NEF, ARW and
  DNG are plain TIFF inside, so they also need their extension or declared type, and a TIFF
  photo is never taken for one. Uploads with a vague type get the RAW type from the extension
  and the `image` kind.
- The worker never develops a RAW. exiftool (`libimage-exiftool-perl` in the `-media` image)
  extracts the embedded JPEGs (`JpgFromRaw`, `PreviewImage`, `OtherImage`) and the largest
  becomes the source of the usual WebP thumbnails and palette, turned by the EXIF orientation
  of the RAW (the preview is stored as the sensor saw it). EXIF comes from exiftool with the
  same fields as photos and the same rule: no location. exiftool runs with a 2 GiB address
  space, 30 seconds, and no environment of the server.
- Previews larger than 64 MB are not read (exiftool cannot write them either), and sharp
  decodes at most about 100 megapixels of one.
- No exiftool, `RAW_PREVIEWS=false`, or no usable preview: the asset is ready without
  thumbnails, with its RAW `mime`, and keeps the kind it was uploaded with. The original is
  downloaded as it is. `Instance.media.rawPreviews` says whether the instance makes them;
  `RAW_IMAGE_TYPES` in `@inkadra/shared` lists the types for the cards to come.

**PDF.**
- A file whose first bytes hold `%PDF-` gets the `application/pdf` type, its page count from
  poppler's `pdfinfo`, and page 1 rendered by `pdftoppm` (`poppler-utils` in the `-media`
  image) within its crop box, 2048 pixels on its longer side, as the source of the usual
  thumbnails. `width` and `height` are those of the rendered page, so a card can follow the
  aspect ratio of the document (A4 portrait, landscape tickets). Only page 1 is ever read.
- Poppler runs no scripts and opens nothing over the network. Each run has a 1 GiB address
  space, 30 seconds and no environment of the server.
- Encrypted (with a password to open) or broken PDFs, `PDF_PREVIEWS=false` or no poppler:
  the asset is ready without thumbnails and `pageCount` stays null; the card keeps its badge.
  Rendering in the browser with pdf.js stays for the viewer and for screenplays (#294).
  `Instance.media.pdfPreviews` says whether the instance makes them.

**Consequences.** A ProRes card plays everywhere once its copy is made, at the cost of CPU in
the worker and roughly 40 MB per minute of storage at the default bitrate. Instances on the
standard image have no ffmpeg: their videos keep `proxy: null` or `skipped`, as before, and
their RAW files and PDFs stay file cards. The `-media` image grows by exiftool (Perl) and
poppler, a few tens of MB.
