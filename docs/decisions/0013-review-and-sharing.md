# 0013 · Review and sharing: comments, approvals, guest links, versions

Proposed, 2026-10.

**Context.** Wave 3 turns boards into something a team shows to a client: people comment on
cards and mention each other, a director or a client approves frames and pictures, a
photographer sends a selection to someone without an account and gets picks back, and a board
can go back to how it was before a bad afternoon. Three things constrain the design. Commenters
and viewers are read-only on the board document (decision 0011), so anything they write cannot
live in it. Guests have no account and must never receive the Yjs document, which holds every
card, including the ones not meant for them. And approvals are a record people rely on, so it
must say who decided and when.

**Decision.**
- **Comments live in Postgres** (`comment`), on a board (`element_id` null) or on a card
  (element id of the document). A thread is its first comment plus replies, one level deep.
  Viewers read, commenters and above write; you edit your own comments, you delete your own or,
  as editor or owner, anyone's; any commenter resolves and reopens a thread. A deleted thread
  start with replies stays as an empty placeholder. Comments about a card that was later
  removed stay, shown as about a removed card. A card may be commented at a point (`pin`, 0–1
  relative to the card).
  The document was rejected for comments: commenters cannot write it, Yjs cannot enforce who
  edits or deletes a comment, tombstones would grow every board, guests cannot receive it, and
  notifications need a server-side event anyway.
- **Mentions** are written `@{userId}` in the plain-text body and shown with the current name
  (`mentions` in the answer). The server keeps only mentions of people who can read the board,
  checked with `apps/server/src/access.ts` like every role. Guests cannot mention.
- **Visibility.** A thread is `team` (default) or `everyone`. Guests read and write only
  `everyone` threads; internal discussion on a shared board never reaches them.
- **Real time without a second channel.** After a change the server sends a stateless message
  on the board's collab connection, like `access` in decision 0011: `comments`, `review` and
  `restored` (`BoardNotice` in `@inkadra/doc-schema`). It only says what changed; clients fetch
  over REST, so the permission rules stay in one place. Guests have no WebSocket: they poll the
  snapshot with `If-None-Match`.
- **Review status lives in Postgres**, not in the document: `element_review` holds the current
  status of a card (`none`, `in_review`, `approved`, `changes_requested`, with a short note) and
  `element_review_event` every change with its author (account or guest). Commenters and above,
  and guests of `guest_approve` links, set it. Keeping it out of the document means a guest can
  approve through the API without any write access to the document, an editor cannot rewrite an
  approval by editing a field, old clients cannot drop it, and the history is an append-only
  table. A copy in the document was considered and rejected: two sources of truth, and the copy
  would be forgeable by any editor. The cost is one request per board (`GET /reviews`) and no
  statuses offline; restoring a version leaves reviews as they are. Review status is separate
  from the production status of storyboard frames (`draft` … `retake`), which stays in the
  document.
- **"Hidden from guests" is an element field in the document** (`guestHidden`, optional
  boolean). Editors toggle it while arranging a board, and it travels with the card through
  copies, versions and restores. Hiding a column or scene hides what is inside it; hiding a
  board card keeps its board out of the link. The flag is a filter applied by the server when it
  renders guest snapshots, never by the guest's browser.
  The field is optional, so the document schema version stays at 2: builds without it accept
  the element and keep the field untouched in the Y.Map (`readElement` ignores unknown keys; a
  test covers it), and only servers that know the field serve guest links. Decision 0012 bumped
  the version for new element types, which older servers could not show; this field changes
  nothing for them.
- **Guest share links** (`share_link`) point to a board, optionally with its sub-boards, with a
  role `guest_view`, `guest_comment` or `guest_approve`, an optional password, an optional
  expiry, `allowDownload` and `proofing`. Editors and owners create, change and revoke them
  (50 an hour per person). A guest (`share_guest`) is one browser with the name it typed,
  asked before the first comment, review or pick. Links are revoked, not deleted, so comments
  and picks of their guests keep an author.
- **Photo proofing.** On links with `proofing`, guests pick or reject a picture and give it 1 to
  5 stars (`share_pick`, one row per guest and card, with the asset shown at the time). The
  people who manage the link see the totals per card and each guest's choice
  (`GET /share-links/{id}/picks`); exporting the list of file names is done in the browser.
- **Board versions live in Postgres** (`board_version`, a full Yjs update in `bytea`, like
  `board_doc`). Board documents hold no files and stay small, so Postgres keeps versions in the
  same backup and transaction as the board, and they go away with it. If they ever grow,
  a nullable storage key can be added later. The collaboration server takes an `auto` version
  when it stores a document whose last automatic version is older than one hour; retention
  keeps automatic versions hourly for 48 hours, then one per day for 30 days. `named` versions
  are kept until someone deletes them; naming an automatic one keeps it. **Restore** saves the
  current state as a `restore` version, then writes the old content on top of the live
  document as a normal change (elements added, changed and removed), so CRDT history goes on,
  open boards follow and offline edits still merge. Preview downloads the version as a Yjs
  update and renders it read-only in the editor; the server renders nothing. Editors and owners
  list, save, preview and restore.
- **Notifications** (`notification`) are written by the server, never by clients: `mention`,
  `reply` (in a thread you wrote in), `comment` (new thread on a card you created), `review`
  (status change on a card you created or asked review for) and `invitation_accepted`. The
  actor is never notified, and one event gives one notification per person (a mention in a
  reply is a `mention`). The unread count is polled (once a minute and on focus); there is no
  per-user WebSocket channel in 1.0. Email follows `notification_preference.email`:
  `immediate` (grouped, a few minutes after the first unread), `daily` (one digest of what is
  still unread) or `off`; without SMTP nothing is sent. Notifications are kept 90 days.
- **Export to PDF and PNG stays in the browser.** The client draws the board it already has
  with `@inkadra/canvas-core`, using the same-origin thumbnails (2048 px) for pictures, so it
  needs no endpoint and no contract. If a headless export (mobile, scheduled) is ever needed,
  it gets its own decision.

**Security model for guests.**
- **No document, no WebSocket.** The collab server accepts only sessions and tokens of
  accounts; a guest cookie is never a credential there. Guests get a snapshot rendered by the
  server from the stored document: hidden elements and their children are left out, arrows
  attached to them are dropped, board cards pointing outside the link are dropped, `createdBy`
  is always null and note rich text is converted to ProseMirror JSON.
- **Files only through the link.** Guest file URLs live under
  `/api/v1/guest/links/{linkId}/assets/…`, and the server answers only for files referenced by
  an element visible on one of the link's boards, checked on every request. Pictures and video
  posters are served only as the WebP thumbnails (which carry no EXIF).
  Originals, including video and audio, are served only when the link has `allowDownload`, and
  then always as attachments with the sandbox policy of `/assets/{id}/file`. File names, sizes,
  EXIF, palettes, hashes and source addresses are not in guest answers, except name and size
  with `allowDownload`.
- **Tokens and passwords.** Link tokens are 32 random bytes, looked up by SHA-256 and kept
  sealed (AES-256-GCM, key from `AUTH_SECRET`) so managers can copy them again, as for link
  invitations. Passwords are hashed with the same scrypt hasher as account passwords; wrong
  passwords are rate limited per link and client address, and the answer never says whether
  the password was close.
- **Guest session.** Opening the link sets the `inkadra.guest` cookie (`__Secure-` over HTTPS),
  HttpOnly, SameSite=Lax, with `Path=/api/v1/guest/links/{linkId}`, so each link has its own
  session and the cookie is never sent to the rest of the API. Its token is random, stored as a
  SHA-256 and replaced each time the guest opens the link again. Every guest request checks the
  link again: revoked or expired links stop at once, a password change invalidates sessions
  opened before it (`sessions_valid_after`), and the role and options are those of the link at
  that moment. Guest write requests follow the same origin checks as account requests.
- **The guest page** sends `Referrer-Policy: no-referrer` and `noindex`, so the token does not
  leak to the sites of link cards or into search engines.
- **Separate from roles.** Guest roles are not project roles and never appear on access lists.
  What each guest role may do is decided in `access.ts` next to the account roles, so there is
  still one place to read permissions from.

**Consequences.** Comments, reviews, picks and versions are new tables with board-scoped
cascades. Clients make two more requests when opening a board (comment counts and reviews) and
follow stateless notices for changes. Rendering guest snapshots costs a document decode per
change of the board, so snapshots are cached by document `updated_at` and link options (the
`version` / ETag). Anything that ever cleans up unused files must also look inside board
versions, because a restore can bring a file back.
