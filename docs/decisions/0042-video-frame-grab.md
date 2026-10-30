# 0042 · Video stills and their source

Proposed, 2026-10. Extends [0009](0009-files-and-media.md) and
[0011](0011-collaboration-and-access.md).

**Context.** A storyboard picture or board image captured from footage needs both a new image
asset and durable provenance. Captions and director's notes remain editable text and cannot
reliably encode the source. External player iframes cannot be captured by a same-origin canvas.

**Decision.**
- Document version 5 adds optional `source` to image and frame elements. An `uploaded-video`
  source holds the original asset UUID and finite, nonnegative `timeSeconds` (fractional seconds
  preserve the presentation timestamp). A `link-thumbnail` source holds an HTTP(S) reference URL
  and optionally a reference time. Its thumbnail does **not** depict that reference time.
  The resulting picture stays in the existing `assetId` field; links retain `imageAssetId`.
- Migration from version 4 changes only the schema version. Existing pictures have no source;
  we never infer a timestamp or overwrite notes. This metadata grants no file access: source
  assets remain subject to normal project and board permissions. Consumers must treat a
  missing/deleted source as an unavailable reference, without losing the captured picture.
- The subsequent UI captures only playable same-origin uploaded videos at their intrinsic
  dimensions, handles unavailable/tainted canvases, and uploads PNGs through the normal tus
  flow and media worker. It offers a storyboard frame picker or an image card next to the
  video. Read-only and guest viewers cannot create captures. Captures inherit the source
  card's explicit and inherited guest visibility to avoid exposing hidden footage.
- Paused stepping should use decoded presentation timestamps when available through
  `requestVideoFrameCallback`. That API reports displayed frames, not a frame-rate or a
  backwards-step operation: do not label a fixed 1/30-second seek as frame accurate. The UI
  must expose any fallback limitation rather than promise precision on variable-rate footage.
- YouTube/Vimeo use only the thumbnail already fetched by the server through bounded oEmbed
  and SSRF-checked image requests. Reuse its stored asset; no endpoint or video download is
  needed. Explain that external players cannot supply captured frames. For YouTube, retain
  an explicitly supplied reference time in `source` and append a `?t=` reference to frame
  notes without replacing existing notes. Never infer current iframe time from the host
  video element or represent the thumbnail as a capture at that time.
- Keep the strict CSP unchanged. Vimeo remains a link/thumbnail, not a newly permitted iframe.
  Reuse viewer controls, Inkadra tokens and Italian/English strings. The implementation PR
  supplies desktop/phone, light/dark screenshots and capture/thumbnail end-to-end tests.

**Consequences.** Provenance is structured independently of captions and notes; older builds
reject version 5 documents rather than silently discard it. No API, database or media pipeline
change is required for this contract. UI implementation follows maintainer review of the
contract PR, as required by CONTRIBUTING.md. Browser stepping precision needs validation on
both fixed-rate and variable-rate fixtures in that implementation.
