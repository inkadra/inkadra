# 0128 · Playable video copies: quality presets, an H.264 ladder played over HLS

Status: accepted, 2026-11-13. Supersedes the parts "What is made", "Limits", "Hardware encoding"
and "API" of [0048](0048-media-worker-previews.md) for videos (audio copies of
[0051](0051-audio-cards.md) do not change). Amends [0124](0124-settings-redesign.md): the Server
group gains a seventeenth page, Video. Follows the capability pattern of
[0120](0120-board-writers.md) and [0122](0122-set-plan-sheet-from-the-server.md).

## Context

Playable copies looked compressed. On Quick Sync and VAAPI (the maintainer's instance runs an
Intel N100 in low-power mode) the encoder was asked for an average of **half the peak**,
`-b:v 2.5M -maxrate 5M` for 1080p at any frame rate, with `-preset veryfast`; libx264 used
`veryfast`, CRF 23 under a 5 Mbit/s buffer; NVENC had no AQ and no lookahead. One rate served
480p and 1080p, 24 and 60 fps. Ten-bit and HDR sources (iPhone HLG, camera log) were cut to 8 bit
without dithering on the GPU path and never tone mapped, so they came out grey; keyframes were
up to ten seconds apart. Robustness gaps: sources over 20 GB never got a copy (a four-minute
ProRes 422 HQ UHD clip), a copy cut short by `-fs` or by a decode error was saved as ready, the
time limit was four times the duration and never retried, interlaced sources kept their combs,
a camera file with two mono tracks played one channel, a lost queue left assets `queued`
forever, and a 4K 100 Mbit/s MP4 was served as is because the browser can decode it.

## Decision

### What is made

`videoPlan` gives each upload one of:

| Source                                                             | Copies                                  |
| ------------------------------------------------------------------ | --------------------------------------- |
| Audio not every browser plays                                      | AAC M4A, as in 0051                     |
| Plays in the browser and is **light**                              | none                                    |
| Plays in the browser but is **heavy**                              | the ladder; the original stays a choice |
| QuickTime/Matroska with light 8-bit H.264 (phone MOV)              | a remux, one `proxy` copy, as today     |
| Anything else (ProRes, DNx, HEVC, 10 bit, 4:2:2, MXF, AVI, AV1, …) | the ladder                              |
| Past the limits, copies off, no ffmpeg                             | `skipped`                               |

**Heavy**: shorter side over 1080, or more than 12 Mbit/s on average (`size × 8 / duration`),
or more than 60 fps. **Light enough to remux**: 8-bit 4:2:0 H.264, no larger than the copy, at
most 60 fps and no heavier than the peak of the High preset at its size. The setting "Video che
il browser riproduce già" can make the ladder for every playable original, or never.

**The ladder** is H.264 High, 8-bit 4:2:0, AAC-LC stereo 48 kHz 128 kbit/s. Rungs by shorter
side: 480, 720, 1080 (the default set) and 2160 (off by default). A source of shorter side `S`
gets the chosen rungs below `S` and a top rung of `min(S, highest chosen)`: **never upscaled**;
a 900p source with 480/720/1080 gets 480, 720 and 900 (row `1080`, real height 900, rate scaled
by area). Rungs within 80 % of the top one are dropped (a 540p source gets 540 only).

**One file per rung**, fragmented MP4 with a single `sidx` index at the front
(`+frag_keyframe+empty_moov+default_base_moof+global_sidx`, fragments of about four seconds
starting on keyframes), stored at `variants/<assetId>/r<gen>-<rung>.mp4`. The worker reads the
index into a byte-range HLS media playlist kept in the database row; the master playlist is
generated per request from the ready rows. No segment folders: storage stays "one file, one
row", and every rung is still an MP4 any player can open on its own. DASH adds nothing and loses
Safari. Codec: **H.264 only**. HEVC is out (patents, Firefox); AV1 is detected and shown
("AV1 disponibile") but not used, because Safari decodes it only on hardware with an AV1 decoder
and mixing codecs between rungs breaks level switching.

### Presets

Target video bitrate per rung up to 30 fps (above 30 fps: × 1.4); peak (`-maxrate`) = 1.5 ×
target; buffer = two seconds at the peak.

| Preset                   | 480p  | 720p  | 1080p | 2160p | MB/min 480+720+1080 |
| ------------------------ | ----- | ----- | ----- | ----- | ------------------- |
| Leggera                  | 0.9 M | 1.8 M | 3.5 M | 12 M  | 49                  |
| **Bilanciata** (default) | 1.4 M | 3.0 M | 6.0 M | 20 M  | 81                  |
| Alta                     | 2.0 M | 4.5 M | 10 M  | 32 M  | 127                 |

`MB/min = (video kbit/s + 128) × 0.0075`. These are ceilings: the encoders aim at a constant
quality under the peak, so interviews and screen recordings stay well below. Immich caps its
H.264 HLS rungs at 2.5/5/8/25 Mbit/s with CRF 23: the same range.

| Preset     | libx264 CRF / preset | NVENC CQ | Quick Sync / VAAPI quality |
| ---------- | -------------------- | -------- | -------------------------- |
| Leggera    | 24 / veryfast        | 28       | 28                         |
| Bilanciata | 21 / fast            | 26       | 24                         |
| Alta       | 19 / medium          | 23       | 21                         |

Common to every encoder: keyframes forced every two seconds by time
(`-force_key_frames expr:gte(t,n_forced*2)`, `-g` ten seconds as a net, no scene-cut keyframes),
so every rung switches at the same instants; BT.709 tags written in the bitstream
(`h264_metadata`: ffmpeg 9 turns `-colorspace` into a frame conversion it cannot do on GPU
frames), the CPU scaler converting matrix and range to them; `-profile:v high`.

- **libx264**: `-crf Q -maxrate -bufsize -aq-mode 3 -sc_threshold 0`.
- **NVENC**, full tuning: `-preset p5 -tune hq -rc vbr -cq Q -b:v 0 -maxrate -bufsize
  -spatial-aq 1 -rc-lookahead 20 -bf 3 -b_ref_mode middle -forced-idr 1 -no-scenecut 1`; basic
  tuning (older cards): without `-tune`, lookahead and B-frame references.
- **Quick Sync**, full: `-preset medium -global_quality Q -b:v target -maxrate -bufsize -extbrc 1
  -look_ahead_depth 30 -forced_idr 1` (a quality with a target and a cap selects QVBR; Immich does
  the same); basic: VBR at the target.
- **VAAPI**, full: `-rc_mode QVBR -global_quality Q -b:v target -maxrate`; basic: `-rc_mode VBR`.
  Immich notes that VAAPI does not take a quality and a cap together; drivers without QVBR fall
  to basic at detection.

**Detection** tries the full tuning first, then basic, for each backend and entry point, and
records the one that passed (`tuning`) and whether the card encodes AV1 (`codecs`), shown in
Diagnostics and on the Video page. With several workers the last one to start is shown, as
before.

### Filters

`parseProbe` also reads transfer, primaries, matrix, range, field order, sample aspect ratio,
rotation, bitrate and the channels of each audio track.

| Source                                        | Decode | Scale                  | Then                                          |
| --------------------------------------------- | ------ | ---------------------- | --------------------------------------------- |
| 8-bit SDR, upright, progressive, GPU codec    | GPU    | GPU                    | encoder                                       |
| 10-bit SDR or HDR, upright, GPU codec         | GPU    | GPU, staying at 10 bit | download, dither or tone map, upload, encoder |
| Rotated, interlaced, ProRes, DNx, 4:2:2/4:4:4 | CPU    | CPU, lanczos           | upload, encoder                               |

Rotated sources (every portrait phone video) are decoded on the CPU: with frames kept on the GPU,
ffmpeg 9 skips the rotation without an error and the copy comes out on its side (spike).

- 10-bit SDR to 8 bit: `zscale=dither=error_diffusion` (libzimg is in the image's ffmpeg).
- HDR (PQ, HLG) to SDR, on frames already scaled down:
  `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv:dither=error_diffusion`.
- Interlaced: `bwdif=mode=send_frame:deint=interlaced` before scaling. Non-square pixels:
  `setsar=1` after a scale computed on the display aspect.
- Frame rate: timestamps pass through (variable frame rate stays variable); above 60 fps,
  `-fpsmax 60` (the two cannot be combined in ffmpeg).
- Audio: AAC-LC stereo 48 kHz; when the first two tracks are mono they are merged into stereo.

### Robustness

- **Output check**: a copy shorter than the source by more than max(1 s, 2 %) is an error, not
  a ready copy. `-fs` stays only as the kernel's net (`prlimit --fsize`).
- **Time**: a stall watchdog (no progress for five minutes kills ffmpeg, retryable) and the
  four-hour cap per run, no longer shared out between rungs.
- `VIDEO_PROXY_MAX_SOURCE_SIZE` defaults to `0`: the duration limit and the free-space check
  remain; `UPLOAD_MAX_SIZE` already bounds uploads.
- **Stuck states**: the maintenance job queues again assets `queued` or `processing` with no
  live job for over fifteen minutes.
- WebM AV1 is no longer "playable everywhere": it gets the H.264 ladder.

### Live playback

A rung can be **stored** (encoded once, as above) or **live** (encoded while someone watches).
Live is used for rungs still queued or processing right after an upload, so a video plays at
once; for rungs the admin sets to "Solo al volo" (2160p, say); and for "no stored copies" (every
rung live). Capability **`video-live`**; clients need nothing more than `playback.hls`
(`AssetRendition.live` marks the rungs offered live).

- The master playlist lists stored and live rungs together, smallest first; live ones point to
  `live/{rung}.m3u8`, a playlist of two-second fMP4 segments computed from the duration
  (`live/{rung}/init.mp4`, `live/{rung}/seg-{n}.m4s`). Keyframes every two seconds by time in
  both, so hls.js switches between a stored rung (4-second fragments of one file) and a live
  one (2-second segments) without a break: checked in Chromium and Firefox, including a live
  rung whose ffmpeg was started again mid-way.
- A segment request starts ffmpeg at that segment (`-ss` before the input and `-copyts`, keyframe
  grid kept on even seconds, the `hls` muxer with `-start_number`); later requests wait for their
  file. A request outside the window of what ffmpeg wrote (a seek), or for another rung, starts it
  again. ffmpeg is paused (SIGSTOP) 30 segments ahead of what was asked, resumed under 15. The
  same filters, limits (`prlimit`) and fallback chain (GPU, GPU with CPU decoding, libx264) as
  stored copies; the source is read through `privateInput` with `safeInput`.
- **Only on a GPU** (owner decision, 13 Nov): with libx264 live playback is off and not offered,
  and the Video page says why ("richiede la codifica hardware della GPU"). Only sources the card
  decodes and encodes on its own go live (`liveDecodable`: `gpuDecodes`, upright, progressive,
  SDR); ProRes, DNx, 4:2:2/4:4:4, interlaced, rotated and HDR sources wait for their stored
  rungs, so for them a rung set to "Solo al volo" is stored too (`rungsOf`). A failed GPU encode of a live session has no libx264 or CPU-decode fallback: the
  segment answers 503 and the player keeps to the stored rungs or the original.
- **The cap is measured** when the worker starts on a GPU: five seconds of 1080p H.264 of the
  generated test pattern, decoded, scaled and encoded on the card with the live settings, at a
  lower priority, killed after a minute; sessions = floor(speed / 1.5), from 0 to 8. On the N100
  one session ran at 5.35×, which gives 3 (three ran at 1.78× each, four at 1.33×). 0, a timeout
  or an error turns live off with the reason ("GPU troppo lenta per il tempo reale", or the log).
  Saved with the encoder (`liveSessions`, `liveSpeed`, `measuredAt`), shown in Diagnostics and on
  the Video page; `VIDEO_LIVE_MAX_SESSIONS` overrides it. The admin may set another value under
  "Avanzate", from 0 (off) to 16, even above the measurement, with the warning "Più del valore
  misurato (N): i video possono andare a scatti"; "Ripristina" goes back to the measurement, and
  the environment variable still wins and locks the field. `video-live` is announced only where
  live playback runs.
- One session per viewer and video (a person, or one guest of a link), a 30-minute lease renewed
  by every request, ended after 5 minutes without one; a sweep every two seconds. Limits: videos
  at once on the server (the cap above) and per person or share link (default 1). They are checked when the master playlist is asked: past
  them it lists only stored rungs, so the player never errors; a segment that cannot be made
  answers 503 with `Retry-After` and hls.js keeps to the other levels.
- Live sessions run in the process that answers the requests (the web role, or `all`): no
  round trip through the queue for every two seconds of video. With several web replicas a
  viewer may get a session on each; acceptable for now. Replicas may share `DATA_DIR`, so each
  process keeps its sessions under `tmp/live/<host>-<pid>/` and its bucket copies under
  `tmp/live-src/<host>-<pid>/`: at start it clears only its own (a restarted container has the
  same host and pid), touches them every two seconds, and once a minute removes the folders of
  other processes untouched for ten minutes (replicas that stopped), as stale job folders are
  swept. Concurrent requests of one session (the player asks `init.mp4` and `seg-0` at once)
  wait for the ffmpeg being started instead of starting another; the source is taken once per
  session. The web role detects its own encoder
  when it is not the worker.
- Buckets: the source is not downloaded per session. A local copy is shared by every session of
  that video and kept in a cache of 20 GiB, least recently used first out, checked when a copy is taken
  and when one is let go; a failed copy is removed at once; the local volume is
  read in place. Ranged reads through ffmpeg were not used: ffmpeg would need the HTTP protocol,
  which `safeInput` forbids on purpose.
- The probe facts the source rule needs are kept in `asset.media_info`.
- Settings → Video (mockup v2, approved 13 Nov): "Riproduzione al volo" after "Video esistenti",
  with Attiva / Spenta / Non disponibile, "Converti al volo" (disabled with the reason on the
  software encoder; "off" when the sessions are 0), the fixed list of what never goes live and,
  per chosen resolution, "Salva su disco" or "Solo al volo". Live rungs take no space in the estimates.

### Data and API

Table `asset_rendition (asset_id, name, status, progress, width, height, codecs, bitrate,
peak_bitrate, bytes, storage_key, playlist, recipe, encoder, created_at)`, key
`(asset_id, name)`. `recipe` (`h264/balanced/1`) says what made a rung: regeneration only
touches rows whose recipe differs. `asset.proxy_status` stays the aggregate older clients read.

Additive in v1, capability **`video-renditions`** in `GET /api/v1/instance/version`:

- `Asset.playback` (optional, `null` for non-videos): `hls` (master playlist URL, `?v=<gen>`),
  `original` (the original plays in the browser), `renditions[]` with name, status, progress,
  size, bitrate and the URL of each rung's file.
- `Asset.proxy` keeps its shape and meaning: for a ladder it serves the highest rung up to 1080;
  for playable originals it stays `null`, so older clients keep playing the original.
- Routes `GET /assets/:id/hls/master.m3u8`, `/hls/:name.m3u8`, `/hls/:name.mp4` (viewer
  access; files immutable thanks to the generation in their URL). Playlists hold relative URIs,
  so the same text serves accounts and guests.
- Guests of share links stream the reduced copies even when the link does not allow downloads,
  as they already hear audio ([0046](0046-animatic-sound-track.md)): streaming a copy is not
  downloading the original. `GuestAsset.playback`, routes under
  `/guest/links/:linkId/assets/:assetId/hls/*`.
- Admin: `GET/PATCH /instance/video-settings`, `GET /instance/video-settings/estimate`,
  `POST/DELETE /instance/video-settings/reprocess`, `POST /instance/video-settings/benchmark`
  (detection and the live measurement again, on the worker; 409 while one runs).

Environment, as for the storage limits: when set it wins and locks the control in the page.
New `VIDEO_QUALITY` (`light|balanced|high`) and `VIDEO_RENDITIONS` (`480,720,1080`).
`VIDEO_PROXY_RESOLUTION` and `VIDEO_PROXY_BITRATE` lose their defaults and become caps on the
top rung and on every peak.

**Storage**: copies count in the instance total and on the Server page, **not** in the
per-person storage limits (decision of the maintainer: a person who uploads one file should not
see their usage grow with every rung). Backups keep excluding copies; "Rigenera" remakes them.

**Regeneration** is an admin action, never automatic: "only missing" or "all made with other
settings", a low-priority backfill in blocks of 200 assets; the old copy goes only once the new
one is ready, and a rung taken out of the settings is removed only by that action.

### Interface

Settings → Server → **Video** (`?section=video`, after Archiviazione): encoder strip, quality
tiles with "circa N MB al minuto", rungs with their estimate and totals for this instance,
the playable-originals choice, "Video esistenti" with the estimate and a Rigenera action, the
encoder details.

Per person or link stays 1 by default and is set through the API only (`live.perViewer`): the
approved mockup has no control for it. `Asset.playback.noLive` (`prores`, `dnx`, `chroma`,
`interlaced`, `hdr`, `rotated`, `codec`) says why a source never plays live on a server where
live playback runs, so the card can show "ProRes: niente al volo, si guarda tra poco"; the
Quality menu tags live levels "al volo" ("1080p · al volo · copia al 64%") with a note on what
they are, and a card playing one says "al volo 1080p mentre la copia si prepara".

**Avanzate** (a fold collapsed by default after "Riproduzione al volo", badge "Personalizzate";
only `packages/ui` controls and tokens):

- "Rifai il test di prestazioni" queues encoder detection and the live measurement on the
  worker (job `video-benchmark`, stale after 10 minutes); the button shows the run with a meter
  (about ten seconds), then "Misurato adesso" with the new result and its time; disabled
  without a GPU. The running worker keeps the encoder it chose at start; the new
  measurement changes the saved values and the live cap.
- "Sessioni al volo": a number from 0 to 16, as above; hidden without a GPU.
- A table per rung (480/720/1080/2160, those not chosen dimmed): target and peak in kbit/s and
  the quality value, labelled by
  the parameter of the active backend (CRF on libx264, CQ on NVENC, global_quality on QSV and
  VAAPI). Fields start from the preset; an edited one is marked "personalizzato" with
  "Ripristina", and a line under the presets says "Personalizzata". The page checks as the server does and
  says it under the field ("Da 200 a 80 000 kbit/s", "Non sotto l'obiettivo", "Da 0 a 51"); under
  the presets "Torna ai valori della preset" drops every custom value. Values are kept in
  `instance_setting` `video` (`custom`); estimates use them, and the rung recipe gets
  `/t<target>p<peak>q<quality>`, so "Rigenera" finds the copies made with other values. Custom
  values apply as given at any frame rate, still under `VIDEO_PROXY_BITRATE` when it is set. No free ffmpeg
  arguments and no backend choice: `VIDEO_PROXY_HWACCEL` still forces one.

The player gets one Quality menu (Auto, the ready rungs, those in preparation
disabled with their percentage, Originale). Playing a file stays part of Board (always on,
0121); the setting belongs to the instance.

## Spike (13 Nov 2026, workstation: RTX 3090, ffmpeg 9.0.2)

Sources: Sony XAVC HS 4K50 HEVC 4:2:2 10-bit S-Log, handheld indoor footage (clip A, 12 s; clip
F, 12 s, noisier). Reference: lanczos 1080p 8-bit; VMAF v0.6.1 at 1080p.

| Encode                                    | A kbit/s | A VMAF | F kbit/s | F VMAF |
| ----------------------------------------- | -------- | ------ | -------- | ------ |
| Before: libx264 veryfast CRF 23, 5M       | 740      | 89.4   | 835      | 83.6   |
| libx264 fast CRF 22, AQ 3                 | 1625     | 92.9   | 1762     | 85.7   |
| **libx264 fast CRF 21, AQ 3**             | 2165     | 94.1   | 2795     | 86.6   |
| libx264 fast CRF 20                       | 2811     | 94.4   | 4090     | 87.2   |
| Before: NVENC p4 CQ 23, 5M                | 3654     | 95.2   | 4722     | 87.8   |
| NVENC p5 CQ 23, spatial + temporal AQ     | 10332    | 95.0   | 12459    | 89.2   |
| **NVENC p5 CQ 26, spatial AQ, lookahead** | 6111     | 94.8   | 11110    | 89.1   |
| NVENC p5 CQ 26, no AQ                     | 2229     | 94.8   | 4736     | 88.2   |

- libx264 CRF 21 is the knee of the curve: Bilanciata 21, Leggera 24, Alta 19.
- NVENC's AQ triples the rate for no VMAF gain (VMAF does not see the banding in shadows AQ is
  there for), and temporal AQ adds nothing over spatial: CQ 26 with spatial AQ, no temporal AQ.
  The peak keeps the rate bounded.
- Three rungs encoded one after the other from this 4K HEVC 10-bit source took 58.7 s, one pass
  with `split` to three encoders 22.6 s (libx264, two threads each): the ladder is made in **one
  ffmpeg run** with `split`, not one run per rung.
- `zscale` dithering takes untagged 10-bit input; the HLG tone-mapping chain runs. Decoding a
  10-bit HEVC UHD clip on the GPU, scaling there to `p010` and tone mapping the 1080p frames on
  the CPU took 3.0 s against 4.3 s decoding on the CPU.
- A rotated HEVC source with frames kept on the GPU (`-hwaccel_output_format cuda`) encodes
  without error but **unrotated** (1920×1080 for a portrait video): rotated sources go the CPU
  way.
- `-fpsmax` and `-fps_mode passthrough` cannot be combined: passthrough up to 60 fps,
  `-fpsmax 60` above.
- Bilanciata 1080p reaches VMAF ≥ 93 on clip A on both encoders; clip F (heavy sensor noise)
  stays near 87–89 at any reasonable rate, as expected for grain VMAF penalises.

### On the Intel N100 (test instance, 13 Nov 2026, ffmpeg 7.1.5 of Debian, iHD driver)

- `h264_qsv` works only in low power (VDEnc): without it "current profile/ratecontrol mode is
  unsupported". ICQ is not supported.
- `-global_quality` with `-b:v` and `-maxrate` selects QVBR (`RateControlMethod: QVBR`), and
  `-extbrc`/`-look_ahead_depth` are accepted, but on VDEnc the quality value changes nothing
  (21, 24 and 28 all give about 6.2 Mbit/s, the target): QVBR behaves as VBR at the target. The
  old settings gave 2.7 Mbit/s for the same 1080p clip.
- VAAPI: QVBR and VBR supported, ICQ not.
- A rotated HEVC source with frames kept on the GPU comes out unrotated (1920×1080): rotated
  sources go the CPU way, as on NVENC.
- 4K HLG to 1080p with tone mapping on the CPU: 0.59× (GPU decode) / 0.56× (CPU decode).
- ProRes 422 UHD to 1080p: 0.79× with two threads, 0.97× with four (720p with a fast scaler:
  1.38×). HEVC 4K to 1080p decoded on the GPU: 3.47×.
- The ladder (480/720/1080) in one run with `split` on the GPU: 10 s of 4K in 4 s.
- Live sessions of 1080p H.264 to 1080p at once: 1 = 5.35×, 2 = 2.66×, 3 = 1.78×, 4 = 1.33×,
  6 = 0.88×, 8 = 0.67× each; from 4K HEVC: 4 = 0.87×, 6 = 0.56×. Hence three sessions by default
  with a GPU.
- On the workstation (RTX 3090, ffmpeg 9), a live 720p rung of a 4K50 10-bit 4:2:2 source
  (CPU decode): first segment after 2.4 s, a seek that starts ffmpeg again 1.6 s.

Not verified here: Safari and ExoPlayer playback of the fragmented files and of live rungs.

## Consequences

- New copies weigh more: about 46 MB per minute for 1080p (20–38 before), 81 MB per minute for
  the default ladder. Existing copies stay until an admin regenerates them, after an estimate.
- Instances without a GPU spend about three encodes' worth of CPU per video at most (one decode).
- Dolby Vision profile 5 (no HDR10 base layer) still comes out with wrong colours: it needs
  libplacebo; rare outside phones' own exports.
- The mobile app needs nothing: `Asset.proxy` keeps working. For adaptive playback it reads
  `Asset.playback.hls` with Media3's HLS module and the same authorization header.
