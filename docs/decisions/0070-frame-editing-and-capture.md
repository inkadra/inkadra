# Frame editing and clean stills

**Update (2026-11).** Media tools now ship in standard; `-media` is no longer published. See [0010](0010-images-and-releases.md).

## Context

QA recording 18 and the approved November 4 frames mockup ask for clean stills, moving a
picture into a frame, a simpler full-screen drawing editor and original-resolution capture.
The video proxy defaults to 1080p, so capturing its browser pixels cannot claim original quality.

## Decision

Moving a board image into a frame replaces its reference in one undo transaction and removes
the image card, unless that card holds strokes, a crop, a rotation or a caption: a frame has no
place for them, so the card stays and the toast says why. Drawing, notes and opacity of the frame
stay intact. Locked frames are not destinations. A file becomes the frame's picture only when all
its bytes have arrived, so a failed upload costs nothing and offers Retry on the frame.
Frames retain their picture aspect ratio while resizing. Frame and story-card panels follow
selection through the same selection effect.

Drawing uses a floating toolbar and arrow navigation, without layers, guides, onion skin or
a scene strip. The view moves with space and drag, the wheel or two fingers. Existing strokes, shapes and reference opacity remain readable and editable.
Photos start with red ink; blank frames retain dark ink.

A new additive authenticated `GET /assets/{assetId}/frame?time=…` endpoint extracts a PNG from
the original for editors. The existing upload pipeline saves it as a normal image. It retains
permission checks, bounded execution, local-only demuxing and isolated media input. OpenAPI
is updated. No database or board document schema changes are needed, so the schema-16 client
guard introduced by #410 remains unchanged. Existing documents and clients remain compatible.

### Limits of frame extraction in the web role

The endpoint answers one request with one picture, so ffmpeg runs in the web role, not the worker.
Moving it would take a queue, a result store and polling for a request a person waits on, while
decision 0048 keeps long jobs in the worker; a frame is one short seek. In split deployments this
means an untrusted file is opened by the web role, which otherwise never decodes uploads. That is
accepted and bounded: it needs the `-media` image (without ffmpeg the endpoint answers 404), an
authenticated editor of the project, and the same `safeInput`, private input folder, memory and
file limits as the worker. Each person has 12 frames a minute and the process runs 2 at once. Free
space is checked before anything is copied. A two-minute deadline covers the download from a
bucket, ffmpeg (30 s of its own) and the response, and a client that leaves stops all three. The PNG
is streamed from the job folder, never held in memory. Whenever the endpoint cannot answer
(limits, past the last frame, a very large original on a bucket), the browser keeps the frame it
already has from the playable copy and says it is that copy's quality.

### Links: a photo of the tab

YouTube and Vimeo do not let a page read their player. Where a desktop browser offers
`getDisplayMedia`, the person can take a photo of the tab: the panel explains it, the browser asks
permission once per capture, and the tracks stop as soon as there is a picture, or an error.
Region Capture cuts it down to the player where available (Chrome, Edge, this tab only); a box
crops the rest by hand. Only the resulting image is stored; its origin stays in `source`, as
`link-thumbnail`, since the board schema does not change here and Info shows only address and time.
Phones and browsers without the API get a screenshot or the stored thumbnail instead, as do refused
or failed captures. A screenshot can depict anything, so it claims no origin. Existing video and
thumbnail provenance is kept in `source` and shown in Info; generated captions and YouTube URLs in
director notes stop.

An earlier test on the shared Chrome 156 Linux browser, without a display, rejected the API with
`NotSupportedError`, which says nothing about a graphical install. Tab capture is **not yet verified
on real Chrome**: automated tests use a stand-in for the permission, and the first real test is a
manual one.

## Consequences

No third-party video downloading, new dependencies or destructive document migration. Should the
real Chrome test fail, removing `canCaptureTab` from the panel leaves the fallback, with no redesign.
