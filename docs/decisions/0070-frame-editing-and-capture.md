# Frame editing and clean stills

## Context

QA recording 18 and the approved November 4 frames mockup ask for clean stills, moving a
picture into a frame, a simpler full-screen drawing editor and original-resolution capture.
The video proxy defaults to 1080p, so capturing its browser pixels cannot claim original quality.

## Decision

Moving a board image into a frame replaces its reference and removes the image card in one
undo transaction. Drawing, notes and opacity stay intact. Locked frames are not destinations.
Frames retain their picture aspect ratio while resizing. Frame and story-card panels follow
selection through the same selection effect.

Drawing uses a floating toolbar and arrow navigation, without layers, guides, onion skin or
a scene strip. Existing strokes, shapes and reference opacity remain readable and editable.
Photos start with red ink; blank frames retain dark ink.

A new additive authenticated `GET /assets/{assetId}/frame?time=…` endpoint extracts a PNG from
the original for editors. The existing upload pipeline saves it as a normal image. It retains
permission checks, bounded execution, local-only demuxing and isolated media input. OpenAPI
is updated. No database or board document schema changes are needed, so the schema-16 client
guard introduced by #410 remains unchanged. Existing documents and clients remain compatible.

The actual shared Chrome 156 Linux browser rejected `getDisplayMedia` after a real button
click with `NotSupportedError: Not supported`. Use the approved fallback: choose a screenshot
or reuse the stored thumbnail, including on phones. This does not establish support or failure
on a graphical desktop Chrome installation. A manually supplied screenshot can depict anything,
so it is not falsely tagged as the link's thumbnail. Existing video and thumbnail provenance is
kept in `source` and shown in Info; generated captions and YouTube URLs in director notes stop.

## Consequences

No third-party video downloading, new dependencies or destructive document migration.
Tab capture and its crop UI remain unavailable pending a successful graphical Chrome test.
