# 0074 — Phone notes and the guest review

Issue #110 brings the full-screen note and the client review to phones (approved mockup v1,
screens 4 and 9). Both need a few additions to the contracts.

## Note bodies (document version 19)

Notes keep their rich text in the `body` Y.XmlFragment. Version 19 adds two ProseMirror nodes,
recorded in `NOTE_BODY_FORMAT`:

- `mention`, inline and atomic: `id` (an account of the project) and `label` (the name when it
  was written). It is shown as `@label`; the name is not refreshed when the account changes it.
- `noteImage`, a block: `assetId` (an uploaded picture of the board's project) and an optional
  `alt`. Pictures come from the photo library or the file picker; there is no in-app camera.

The migration from version 18 is a no-op: existing notes stay as they are. The bump is what
protects them, as in decision 0068: y-prosemirror drops nodes an editor does not know when it
normalizes a note, so clients older than 19 stay read-only on these documents and the server
keeps their connections read-only.

Guests receive a mention's `label` only, never the account id. Pictures in a visible note are
shown to guests like any other picture of the board. Project import maps `noteImage` to the
imported file, or drops it when the file was not stored, so a note can never reach a file of
another project; mentions become plain `@Name`, as comments do (decision 0037).

A mention in a note does not notify anyone. Notifications for mentions exist only for comments,
which are written once and sent; a note is edited live, letter by letter, and has no moment when
it is "sent". Notifying from notes needs its own design (when, how often, what if the mention is
removed again) and is left for later.

## "Is typing"

Presence (`PresenceState`, not stored) gets an optional `typing` boolean: keys pressed in the
`editing` element within the last seconds. Clients clear it about two seconds after the last key.
The server forces it to false for read-only connections and when `editing` is null. Older clients
leave it out. Guests have no presence: they never see who is typing nor appear to be typing.

## Guest review: versions and summary (API 0.10.0)

The client compares a shot with an earlier named version (`board_version`, kind `named`), the
choice approved for the mockup. Named versions are full document snapshots, and files are never
deleted while a version refers to them, so a frame's picture, action and labels of then are
there to compare. `GET /guest/links/{linkId}/boards/{boardId}/versions` returns the newest five
named versions with only their frames, and only frames that guests of the link see both in that
version and now, cut to the guest allow list. Pictures not in the snapshot are served as
thumbnails through a route scoped to the version, checked on every request; never as downloads.
It needs the review right (`guest_approve`), like deciding.

Decisions stay saved one at a time. `POST …/review-summary` tells the person who made the link
(new `review_submitted` notification, without new database columns) and answers the counts of the
link's decisions on the visible cards. It is idempotent: without a decision changed since the
last summary of the link on that board, nobody is notified. It counts as a guest write (60 a
minute per guest).
