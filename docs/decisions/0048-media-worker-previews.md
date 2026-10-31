# 0048 · Media worker previews: playable video copies

Proposed, 2026-10. Extends files and media (decision 0009) and the `-media` image (decision
0010). Part of the file card family (#325); the cards themselves come later, after a mockup.

**Context.** Camera files (ProRes MOV, MKV, AVI, MXF, HEVC) often do not play in the browser.
The worker already reads the duration and a poster frame with ffmpeg, but playback depends on
what the browser happens to decode, and a card that does not play is a dead end.

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
  `VIDEO_PROXY_MAX_SOURCE_SIZE` (20 GB) are skipped. ffmpeg gets only the file protocol and a
  list of demuxers (as for posters), a 4 GiB address space through `prlimit`, no environment
  of the server, and four times the length of the video (at least 10 minutes) before it is
  killed. Jobs run in their own BullMQ queue, `media-proxies`, one at a time per worker
  (`VIDEO_PROXY_CONCURRENCY`), two attempts; without Redis they run one after the other in the
  web process.
- **Storage.** The copy is the `proxy` row of `asset_variant` (`mime`, `bytes`), at
  `variants/<assetId>/proxy.mp4`, so it is removed with the asset like the thumbnails. It is
  never listed with the thumbnails. A second pass of the thumbnails keeps it: originals never
  change. `VIDEO_PROXIES=false` turns copies off for an instance that would rather save the
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

**Consequences.** A ProRes card plays everywhere once its copy is made, at the cost of CPU in
the worker and roughly 40 MB per minute of storage at the default bitrate. Instances on the
standard image have no ffmpeg: their videos keep `proxy: null` or `skipped`, as before.
