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
  so open boards receive it like any other edit. In `all` mode the web role calls the
  collaboration server in the same process. In split mode it puts an `add-card` job on the
  `collab` queue (Valkey) and waits up to 10 seconds for `inkadra collab` to apply it. Without
  a reachable collaboration server (a `web` role without `REDIS_URL`) clips are refused.
- **Once the card is in the live document the clip has succeeded.** The direct connection
  closes like a browser tab: the document is stored after the usual debounce, which also
  rebuilds its search index, and a store that fails keeps the document in memory for the
  next one, as for edits made in the web app. Nothing after that point (storing, queueing
  the processing of its files) can turn the answer into an error or delete the card's files.
  (Closing with an immediate store would unload the document even when that store fails.)
- **Queueing the clip's own background work is bounded too.** A Valkey that goes away after
  the connection was made does not fail an add, it holds it until it is back. So queueing the
  processing of the clip's files, and the removal of the files of a clip that failed, waits
  at most 2 seconds: the answer (201, or the error) is sent either way. Files left
  unprocessed are queued by the hourly upload purge, and a late add of the same asset is a
  no-op thanks to its job id. Files whose removal could not be queued are removed by the web
  role itself, since their rows are already gone and nothing else would find them. Link
  previews queue their image the same way.
- **A card never appears after the client was told it failed.** The job carries a deadline
  (`expiresAt`, the end of the 10 seconds) that `inkadra collab` checks right before writing,
  so a job that is late (collab slow, restarting or down, or Valkey slow to take the job) is
  refused. The job is not retried, and the worker has `maxStalledCount: 0`, so a stalled job
  fails rather than runs twice. When the wait ends, the web role removes a job that has not
  started; one already running gets 5 more seconds to answer. Adding the job is bounded by the
  same deadline, so a Valkey that does not answer cannot hang the request; if the add lands
  after the web role gave up, the job is removed as soon as it does. If collab still
  does not answer, or a job stalls, the card may or may not be on the board: the client gets
  a 500 asking to check the board, and the clip's files are kept and processed (unused, they
  only take space). The clipper shows that answer, and any other server error on a clip, as
  "check the board before trying again" rather than a plain retry. This relies on the clocks
  of `web` and `collab` agreeing within seconds, which NTP gives; removing late jobs covers
  the rest. Failed jobs, which hold what the
  person wrote, are kept for an hour.
- The card goes at the bottom of "Non ordinati" (`parent: unsorted`), or of the column given
  as `columnId`, with a fractional `z` after its last sibling, `createdBy` the person and
  `createdAt` the server time, using the same `@inkadra/canvas-core` function as the web app.
  A `columnId` that is not a column of that board is refused with 400, and files already
  stored for the clip are deleted.
- What becomes what: a file is stored through the upload store (so large files stream to the
  bucket in parts), sniffed from its first bytes like uploads, and becomes an image card or a
  file card. In a form, `boardId` must come before the `file` part (400 otherwise): access is
  checked before a byte of the file is written, without buffering it, and a refused file is
  read to the end and dropped so the answer is not held up. Temporary folders a crash left
  behind are removed when the web role starts. Empty form fields, `tags` included, count as
  missing. An empty file is
  refused; a file that cannot be stored whole is removed from the store, which also aborts a
  multipart upload to a bucket. A `url` alone is fetched once with the link-preview rules
  (decision 0009): an image (at most `UPLOAD_MAX_SIZE` and 50 MB, since it is held in memory)
  whose first bytes are an image becomes an image asset and card; anything else a link card
  with the page's title and image, reading at most 1 MB of HTML as link previews do. A page
  that cannot be read for any reason (refused, private, too large, cut off) still gives a
  link card with the bare address. A `text` becomes a note: the text as a quote, the note
  below it, then a link to `sourceUrl` (or `url`). `sourceUrl`, kept on the assets, must be
  an http(s) address (400 otherwise).
- `note` is the image caption, the description of a link card (in place of the page's) and a
  paragraph of a text note. File cards have no text of their own, so a note sent with a file
  that is not an image is not kept. `tags` are normalised as the web app's tag editor does
  (no leading `#`, single spaces, lower case, at most 20).
- Clips share the error codes of the other write routes: 413 over `UPLOAD_MAX_SIZE` (no
  limit when it is 0, as for uploads), 429 over 30 clips a minute per person.

**Consequences.** Any later server-side edit of a board (imports, automations) can reuse the
same writer and queue. Split mode needs Valkey for `collab` as well as for `web` and `worker`,
which `compose.yaml` already provides. The assets of a clip are processed only once its
card is on the board.
