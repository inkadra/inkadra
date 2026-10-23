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
  (element id of the document). A thread is its first comment plus replies, one level deep; a
  reply always belongs to a thread of the same board (composite foreign key). Viewers read,
  commenters and above write; you edit your own comments, you delete your own or, as editor or
  owner, anyone's; any commenter resolves and reopens a thread. A deleted thread start with
  replies stays as an empty placeholder. Comments about a card that was later removed stay,
  shown as about a removed card. A card may be commented at a point (`pin`, 0–1 relative to
  the card).
  The document was rejected for comments: commenters cannot write it, Yjs cannot enforce who
  edits or deletes a comment, tombstones would grow every board, guests cannot receive it, and
  notifications need a server-side event anyway.
- **Comment lists** are ordered by when the thread was started, newest first, with the id as a
  tie-breaker, and paged with an opaque keyset cursor on `(created_at, id)`. A thread start
  never changes those, so replies, edits and resolutions never move a thread between pages (an
  order by last activity would skip and repeat threads while people reply). Each thread
  carries `replyCount` and its latest 50 replies; `GET /comments/{id}/replies` pages through all
  of them, oldest first, on the same kind of cursor.
- **Mentions** are written `@{userId}` in the plain-text body and shown with the current name
  (`mentions` in the answer); clients render `@{id}` as a mention only for ids listed there.
  The server keeps only mentions of people who can read the board, checked with
  `apps/server/src/access.ts` like every role. Guests cannot mention: what they type is kept
  as text and never becomes a mention.
- **Visibility and audience.** A thread is `team` (default) or `everyone`. Guests never see
  `team` threads. An `everyone` thread also has an audience, `share_link_id`: null means every
  link that may read comments (only the team can write such a thread), a link id means the
  guests of that link only. Everything a guest writes carries the guest's link, so client A
  never reads client B's comments, names or replies when the same board is sent to both on two
  links. Guests read `everyone` threads whose link is null or theirs, and within them only the
  replies whose link is null or theirs. The team can also start an `everyone` thread for one
  link. The column cascades with the link, so a guest comment can never fall back to "every
  link". The same `share_link_id` is recorded on reviews and review events made by guests.
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
  document. Clearing a review keeps the row with `none`, so its change time moves.
- **"Hidden from guests" is an element field in the document** (`guestHidden`, optional
  boolean). Editors toggle it while arranging a board, and it travels with the card through
  copies, duplicates, cut and paste, versions and restores (`readElement` and the clipboard
  keep it; a test covers it). Hiding a column or scene hides what is inside it; hiding a board
  card keeps its board out of the link. The flag is a filter applied by the server when it
  answers guests, never by the guest's browser. The check fails closed: a card whose chain of
  containers is broken (a parent that no longer exists, after a column was deleted while a card
  moved into it) or circular counts as hidden; only `unsorted` and the canvas end a chain as
  shown.
  Hiding inherited from a container does not travel: a card copied out of a hidden column is
  shown unless it is hidden itself, so the editor must show which cards guests see.
  **The document schema goes to version 3** for this field, with an empty migration from 2.
  The field is additive, but a missing flag means "shown": a build without it would parse the
  element, drop the unknown key, and copy, duplicate or cut and paste a hidden card without it,
  showing it to guests. With the bump such builds stop at `SchemaTooNewError` and reload.
- **Guest share links** (`share_link`) point to a board, optionally with its sub-boards, with a
  role `guest_view`, `guest_comment` or `guest_approve`, an optional password, an optional
  expiry, `allowDownload` and `proofing`. Editors and owners create, change and revoke them
  (50 an hour per person). A guest (`share_guest`) is one browser with the name it typed,
  asked before the first comment, review or pick. Links are revoked, not deleted, so comments
  and picks of their guests keep an author.
- **A link acts for its creator, checked at every request.** A link can never show more than
  the person who created it may edit today. On each guest request the server computes, with
  `access.ts` (`effectiveRole`, first grant wins), the creator's role on the board of the link
  and on each sub-board. While the creator lacks editor on the board of the link, or their
  account is gone, the link is `suspended` (guests get `unavailable`; it works again if the
  role comes back). Sub-boards are included only where the creator has at least editor, so a
  grant that lowers the creator to viewer on a sub-board, or an owner restricting it, takes it
  out of the link at once. Another editor who wants to keep sharing creates a new link.
- **What guests can open** is decided fail-closed. The board of the link, and with
  `includeSubBoards` each descendant board that is (a) reached from a board guests can open
  through a board card visible to guests, (b) not in the trash, and (c) one where the creator
  has at least editor. A sub-board that is only a descendant, without a visible board card
  leading to it, is not included.
- **Everything guests receive is filtered the same way**, not only the elements: the
  snapshot's `reviews`, `picks`, `commentCounts` and `assets`; the guest comment list, counts
  and replies (threads about a hidden card, including through a container, are left out);
  and the asset routes. Writes about a hidden card (comment, reply, review, pick) are a 404,
  as is a reply to a thread the guest cannot read. Board covers of the included boards are the
  one exception to "only files referenced by a visible element": they are served as
  thumbnails only, never as originals.
- **Guest-facing shapes are separate from team shapes.** Guests get `GuestComment`,
  `GuestCommentThread`, `GuestElementReview` and `GuestAuthor` (`team`, `guest` or `deleted`
  with a name only, and `isYou`): no user ids, no avatars, no mention ids (bodies come with
  mentions written as `@Name`), no visibility or audience fields, and no review note unless a
  guest of the same link wrote it. Guests of other links appear without a name. The mobile app
  and the extension will pin these shapes, so they are defined now.
- **Photo proofing.** On links with `proofing`, guests pick or reject a picture and give it 1 to
  5 stars (`share_pick`, one row per guest and card, with the asset shown at the time; the
  guest must belong to the link of the pick). The people who manage the link see the totals
  per card and each guest's choice (`GET /share-links/{id}/picks`); exporting the list of file
  names is done in the browser.
- **Board versions live in Postgres** (`board_version`, a full Yjs update in `bytea`, like
  `board_doc`). Board documents hold no files and stay small, so Postgres keeps versions in the
  same backup and transaction as the board, and they go away with it. If they ever grow,
  a nullable storage key can be added later. The collaboration server takes an `auto` version
  when it stores a document whose last automatic version is older than one hour; retention
  keeps automatic versions hourly for 48 hours, then one per day for 30 days. `named` versions
  are kept until someone deletes them; naming an automatic one keeps it. A board keeps at most
  100 named versions and a person saves at most 20 an hour. Editors may delete a version of
  any kind; automatic and restore versions would go away with retention anyway. **Restore**
  saves the current state as a `restore` version, then writes the old content on top of the
  live document as a normal change (elements added, changed and removed), so CRDT history
  goes on, open boards follow and offline edits still merge. Cards present both now and in
  the version keep their current `guestHidden`, so a restore never shows guests a card hidden
  since the version was taken. Preview downloads the version as a Yjs update and renders it
  read-only in the editor; the server renders nothing. Editors and owners list, save, preview
  and restore.
- **Notifications** (`notification`) are written by the server, never by clients: `mention`,
  `reply` (in a thread you wrote in), `comment` (new thread on a card you created), `review`
  (status change on a card you created or asked review for) and `invitation_accepted`. The
  actor is never notified, and one event gives one notification per person (a mention in a
  reply is a `mention`). The list, the unread count and email all apply the same access
  filter at the time they run: notifications about boards the person can no longer open are
  left out of the list (a page can be short or empty while `nextCursor` is set), are not
  counted in the badge, and are not emailed. The excerpt is not stored: it is rendered from
  the comment as it is now, with mentions as names, and is null once the comment is deleted.
  The unread count is polled (once a minute and on focus); there is no per-user WebSocket
  channel in 1.0. Email follows `notification_preference.email`: `immediate` (grouped, a few
  minutes after the first unread), `daily` (one digest of what is still unread) or `off`;
  without SMTP nothing is sent. Notifications are kept 90 days. A partial index on unread,
  not yet emailed rows serves the mail job and an index on `created_at` the cleanup.
- **Lists** of this wave page 30 items by default and 100 at most, cursors are opaque keysets
  on `(created_at, id)`.
- **Export to PDF and PNG stays in the browser.** The client draws the board it already has
  with `@inkadra/canvas-core`, using the same-origin thumbnails (2048 px) for pictures, so it
  needs no endpoint and no contract. If a headless export (mobile, scheduled) is ever needed,
  it gets its own decision.
- **Open enums.** These values may grow within v1, so clients must accept values they do not
  know in answers: `NotificationType` (shown as a plain line), `ReviewStatus` (shown like
  `in_review`, without actions), `ShareLinkStatus` (treated as not working), `GuestDenied.reason`
  (a generic error), `GuestRole` (treated like `guest_view`), `BoardVersionKind` (like `auto`)
  and the `kind` of `Author` and `GuestAuthor` (like `deleted`). The Zod schemas in
  `@inkadra/shared` stay strict enums, as everywhere else in the repository, because the
  server validates its input with them; clients must not reject a whole answer because one of
  these fields has an unknown value (validate answers leniently or not at all). Adding a value
  is an additive change; removing or renaming one is not.

**Security model for guests.**
- **No document, no WebSocket.** The collab server accepts only sessions and tokens of
  accounts; a guest cookie is never a credential there. Guests get a snapshot rendered by the
  server from the stored document: hidden elements and their children are left out, arrows
  attached to them are dropped, board cards pointing outside the link are dropped, `createdBy`
  is always null and note rich text is converted to ProseMirror JSON.
- **Files only through the link.** Guest file URLs live under
  `/api/v1/guest/links/{linkId}/assets/…`, and the server answers only for files referenced by
  an element visible on one of the link's boards, or the cover of one of them (thumbnails
  only), checked on every request. Pictures and video posters are served only as the WebP
  thumbnails (which carry no EXIF).
  Originals, including video and audio, are served only when the link has `allowDownload`, and
  then always as attachments with the sandbox policy of `/assets/{id}/file`. File names, sizes,
  EXIF, palettes, hashes and source addresses are not in guest answers, except name and size
  with `allowDownload`.
- **Tokens and passwords.** Link tokens are 32 random bytes, looked up by SHA-256 and kept
  sealed (AES-256-GCM, key from `AUTH_SECRET`) so managers can copy them again, as for link
  invitations. Passwords are hashed with the same scrypt hasher as account passwords; the
  answer never says whether the password was close.
- **Preview.** `GET /guest/by-token/{token}` answers revoked, expired and suspended links with
  403 and `GuestDenied` only. For a link with a password it returns only the link id, the
  instance name and `needsPassword`: no board title, sender, role or expiry until the password
  is accepted.
- **Guest session.** The page opens the link with `POST /guest/links/{linkId}/session` and
  `{ token, name?, password? }` in the body: the token stays out of the URL of a write, and the
  path is under the cookie path, so the browser sends the cookie of an earlier visit. If that
  cookie belongs to a guest of this link, even with an expired session, the same guest is
  reused (their comments and picks stay theirs and proofing totals count them once) and the
  cookie token is replaced; otherwise a new guest is created. The `inkadra.guest` cookie
  (`__Secure-` over HTTPS) is HttpOnly, SameSite=Lax, with `Path=/api/v1/guest/links/{linkId}`,
  so each link has its own session and the cookie is never sent to the rest of the API. Its
  token is random and stored as a SHA-256. A session lasts 30 days after the last request
  (sliding: `session_expires_at` moves forward at most once an hour, and the cookie's Max-Age
  is renewed with it), never beyond the link expiry; leaving clears the token. Every guest
  request checks the link again: revoked, expired or suspended links stop at once, a password
  change invalidates sessions opened before it (`sessions_valid_after`), and the role, the
  options and the boards are those of the link and of its creator's access at that moment.
- **Rate limits** (per client address unless stated): previews 60 a minute; wrong passwords 10
  per 15 minutes per link and address; new guests (session opened without a usable cookie) 10
  an hour per link and address and 500 a day per link; guest writes 60 a minute per guest;
  guest comments also 30 an hour per guest and 300 an hour per link. Above them the answer is
  429. `view_count` counts sessions opened or resumed, not polls, so polling writes nothing.
- **Cross-site requests (all cookie-authenticated writes).** SameSite=Lax does not protect
  against sibling subdomains, which are common when self-hosting, and today only Better Auth's
  `trustedOrigins` checks the origin, on `/api/auth`. The rule for the whole of `/api/v1`, for
  account sessions and guest sessions alike: a request with an unsafe method (POST, PUT, PATCH,
  DELETE) authenticated by a cookie must carry an `Origin` equal to the origin of `PUBLIC_URL`;
  without `Origin`, it must carry `Sec-Fetch-Site: same-origin`; anything else is a 403 before
  the handler runs. Requests authenticated by a bearer token (extension, mobile app) are not
  affected. This is a contract for the implementation; it lands with the first endpoint of this
  wave and covers the existing account endpoints at the same time.
- **The guest page** sends `Referrer-Policy: no-referrer` and `noindex`, so the token does not
  leak to the sites of link cards or into search engines.
- **Separate from roles.** Guest roles are not project roles and never appear on access lists.
  What each guest role may do is decided in `access.ts` next to the account roles, so there is
  still one place to read permissions from.
- **Personal data.** Guest names are free text, so the interface always marks guests as
  guests next to their name. Rows of `share_guest` stay while their link exists; once a link
  has been revoked or expired for 90 days, retention clears the names of its guests (totals and
  comments stay, without a name).
- **Checks the implementation must test** (object-level access): a version belongs to the
  board of the path; a reply's thread belongs to the board of the path; a notification belongs
  to the caller; a guest edits or deletes only comments they wrote, on a board their link can
  still open; a guest file is referenced by a visible element, or is the cover, of an included
  board.

**Consequences.** Comments, reviews, picks and versions are new tables with board-scoped
cascades. Clients make two more requests when opening a board (comment counts and reviews) and
follow stateless notices for changes. Rendering guest snapshots costs a document decode per
change of the board, so snapshots are cached by their `version` (the ETag). It covers
everything in the answer: the document `updated_at`, the link's `updated_at`, the set of boards
the guest can open with their titles, covers and the creator's access, the files and the
readiness of their thumbnails, the latest change and the number of the board's reviews and of
the comments this guest can read, and the latest change and number of this guest's picks; a
poll answers 304 only when none of them moved. Anything that ever cleans up unused files must
also look inside board versions, because a restore can bring a file back. Builds older than
document version 3 can no longer open boards saved by newer ones and reload.

**Defaults the product owner may revisit.**
- Review status is shown to every guest role, `guest_view` included, in the guest-safe shape.
- Comments are `team` by default; `everyone` is a deliberate choice.
- Guests of another link appear without a name; guest review notes are shown only to the same
  link.
- Inline replies: the latest 50; lists 30 by default, 100 at most.
- A suspended link cannot be handed over to another editor; they create a new link.
- Guest sessions last 30 days after the last request; the rate limits above.
- Named versions: 100 per board, 20 an hour per person; editors may delete any kind of version.
- Restore keeps the current `guestHidden` of cards present in both states.
- Thread lists are ordered by creation, not by last activity.
- Notifications are kept 90 days; guest names are cleared 90 days after the link stopped.
