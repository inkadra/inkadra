# 0051 · Audio cards: waveform, AAC copies and voice notes

Proposed, 2026-11. Extends the media worker (decision 0048) to sound. Part of the file card
family (#325), issue #327.

**Context.** Voice notes, reference music and sound design belong on the board. Audio files
were generic file cards with a flat bar: no shape to scrub by, and an Ogg or WebM recording
does not play in every browser.

**Decision.**
- **Which files.** An upload is audio by its declared type, or by its extension when the type
  is vague (MP3, M4A, AAC, WAV, FLAC, Ogg, Opus, AIFF, CAF). The worker sniffs the container
  from the first bytes and opens it with ffprobe and ffmpeg limited to the audio demuxers
  (`mov`, `matroska`, `mp3`, `wav`, `aac`, `ogg`, `flac`, `aiff`, `caf`) and the file protocol.
  The sniffed type replaces a vague declared one.
- **Waveform.** ffmpeg decodes the first sound stream to 8 kHz mono PCM on a pipe; the worker
  keeps the loudest sample of every 10 ms, then 160 peaks from 0 to 100 (the loudest at 100),
  stored as `variants/<assetId>/waveform.json`, the `waveform` row of `asset_variant` (the
  column is plain text: no migration). Same sandbox as every media job: its own job folder,
  the original through a private link, the 4 GiB address-space and 1 MiB file caps, `nice`, no
  environment of the server, at most 2 hours of sound, killed past a quarter of the length (at
  least 2 minutes). A file that does not decode has no waveform and is still ready. Served at
  `GET /assets/{id}/waveform` and its guest twin, `Asset.waveformUrl` and
  `GuestAsset.waveformUrl`.
- **AAC copy.** MP3, AAC (ADTS or MP4), PCM WAV and FLAC play everywhere and keep their
  original. Everything else (Ogg, Opus, WebM voice notes, AIFF, CAF, ALAC) gets an AAC M4A
  copy in the same `media-proxies` queue, with the same limits, timeouts and settings
  (`VIDEO_PROXIES` turns both off) as videos: the `proxy` variant, `Asset.proxy.mime`
  `audio/mp4`. The card plays the original where `canPlayType` says the browser reads it,
  else the copy.
- **Guests.** An audio card on a board of the link streams inline at
  `/guest/links/{linkId}/assets/{assetId}/stream`, as the sound track of an animatic does
  (decision 0046): whatever `allowDownload` says, without its name, as the copy when there is
  one. Like viewers (decision 0011), guests stream sound because there is nothing else to show.
- **One sound at a time.** Playing a card pauses any other card and the video or audio of the
  viewer, and the other way round.
- **Voice notes.** "Voice note" in the + menu records with MediaRecorder (Opus in WebM, AAC
  on Safari), at most 15 minutes, and uploads the take as an ordinary audio file. Only where
  the browser can record; never for guests.

**Consequences.** Audio files gain one small JSON file each and, for some formats, a copy
that backups leave out like video copies. The waveform outlives a copy job and comes back on
a second pass of the asset.
