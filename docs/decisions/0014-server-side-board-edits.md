# 0014 · Cards the server adds to boards: the clip endpoint

Accepted, 2026-10.

**Context.** The browser clipper and the mobile share sheet save an image, a link, a text or a
file to a board with one request (`POST /api/v1/clip`), without opening the board. Board
content lives in Yjs documents held by the collaboration server (decision 0004), and in split
mode the web role that receives the request is a different process from `collab`, which has
the documents open. Writing straight to `board_doc` would be lost the next time `collab`
stores its copy of an open document.

**Decision.**
- The card is added **where the document is live**, through a Hocuspocus direct connection,
  so open boards receive it like any other edit and closing the connection stores the
  document and rebuilds its search index at once. In `all` mode the web role calls the
  collaboration server in the same process. In split mode it puts an `add-card` job on the
  `collab` queue (Valkey) and waits up to 10 seconds for `inkadra collab` to apply it; the job
  is not retried, so a card never appears after the client was told it failed. Without a
  reachable collaboration server (a `web` role without `REDIS_URL`) clips are refused.
- The card goes at the bottom of "Non ordinati" (`parent: unsorted`), or of the column given
  as `columnId`, with a fractional `z` after its last sibling, `createdBy` the person and
  `createdAt` the server time, using the same `@inkadra/canvas-core` function as the web app.
  A `columnId` that is not a column of that board is refused with 400, and files already
  stored for the clip are deleted.
- What becomes what: a file is stored through the upload store (so large files stream to the
  bucket in parts), sniffed from its first bytes like uploads, and becomes an image card or a
  file card. A `url` alone is fetched once with the link-preview rules (decision 0009): an
  image (at most `UPLOAD_MAX_SIZE` and 50 MB, since it is held in memory) becomes an image
  asset and card, anything else a link card with the page's title and image; a page that
  cannot be read still gives a link card with the address. A `text` becomes a note: the text
  as a quote, the note below it, then a link to `sourceUrl` (or `url`).
- `note` is the image caption, the description of a link card (in place of the page's) and a
  paragraph of a text note. File cards have no text of their own, so a note sent with a file
  that is not an image is not kept. `tags` are normalised as the web app's tag editor does
  (no leading `#`, single spaces, lower case, at most 20).
- Clips share the error codes of the other write routes: 413 over `UPLOAD_MAX_SIZE`, 429 over
  30 clips a minute per person.

**Consequences.** Any later server-side edit of a board (imports, automations) can reuse the
same writer and queue. Split mode needs Valkey for `collab` as well as for `web` and `worker`,
which `compose.yaml` already provides. The assets of a clip are processed only once its
card is on the board.
