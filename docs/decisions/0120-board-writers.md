# 0120 — The server knows who wrote under each Yjs client id of a board

Status: accepted (owner decisions of 2026-11-12). Follows the model of
[0112](0112-board-restore-history.md). This record is the contract; the table, the collector
and the route come in the next pull request.

## Context

A client that edited a board offline (the Android app first) merges with the live document and
can find that a field it changed was changed by someone else too. Yjs keeps one winner, and
the winning item carries only a client id and a clock (`item.id`), not a person. To say "Giulia
Bianchi also changed this title, about 18:20", the client needs the person behind the id.

Each collaboration socket is authenticated (session or app token) and every update it sends is
applied through `onChange` with that socket as origin, so the server sees which account first
delivered structs under which client id. Guests never open the socket: they cannot write the
document.

## Decision

**Server-side mapping, no author in the document.** The board document schema does not gain a
per-field author: it would grow every document, could be written by anyone holding the id, and
would stay after an account is deleted. The server keeps the mapping instead.

**What is stored.** One row per (board, Yjs client id): the account, or the server itself for
its own writes (restore, clips, migrations); when it first and last stored a write under the
id; and up to 32 marks `[clock, time]`, a new one only when the clock advanced and about a
minute passed since the last, the oldest dropped. Rows are written in one batch when the
collaboration server stores the board (its usual debounce, at most 10 s), never per update. A
failed write is logged and dropped: attribution is best effort, the document is not.

**Retention.** A row is kept 30 days after its last write, the age of daily versions; a device
offline longer has little to merge against. At most the newest 2000 rows per board (every page
load is a new id). The existing version retention job purges both. Deleting the board deletes
its rows; deleting an account sets the row's account to null. Nothing about the person is
copied: the name is read from the account at lookup.

**Route.** `POST /api/v1/boards/{boardId}/writers` with `BoardWritersQuery`
`{ items: [{ client, clock? }] }`, 1 to 50 lookups, `client` an unsigned 32-bit integer, `clock`
an integer ≥ 0. It answers `BoardWriters`, one item per lookup in order:
`{ client, kind, user, changedAt, lastSeenAt }`.

- Anyone with the viewer role or above on the board may ask: they already see editors by name
  in presence; this extends it to the past 30 days. No role: 404 `not_found`, as everywhere.
  Guests and share links have no route. At most 60 requests a minute per account (429).
- `user`: named, also when the person is no longer a member: it is about their past edit, as
  0112 names restorers. `deleted`: the account was deleted; never an email. `server`: the
  server's own write.
- `changedAt` is about to the minute: the time of the first mark whose clock is at or after the
  requested clock, else `lastSeenAt`. Both are null for `unknown`.
- Clients treat a kind they do not know like `unknown`.

**Trust limits.** Yjs does not authenticate client ids. The first socket that delivers structs
under an id owns it. If another account later writes under the same id, the row becomes
`contested` and nobody is named; whoever claims a fresh id first only gets their own name, so
no one can be framed. Pure deletions create no struct of the deleter and read `unknown`. A
write stored less than about 10 s ago is not recorded yet and reads `unknown`: the client
retries for a few seconds, then shows the change without a name, as 0112 does.

**Caching.** A client may cache an answer per (boardId, client, clock) for the session. A
resolved answer never changes; only `unknown` may later become known. So clients cache
everything but `unknown`.

**Older servers.** Servers that answer advertise the capability `board-writers`
(`BOARD_WRITERS_CAPABILITY` in `packages/shared`) on `GET /api/v1/instance/version`. A client
checks it before calling; without it, it shows the conflict without a name. An older server
called anyway answers like any unknown `/api/v1` route: status 404 with
`{ "error": { "code": "not_found", "message": "Not found." } }` from the not-found handler
(`apps/server/src/http/app.ts:238-251`, `sendError` in `apps/server/src/http/errors.ts:27`).
That is the same code a newer server sends for a board the caller has no role on, so only the
capability tells "not supported" apart from "no access"; 5xx and network errors mean the lookup
failed and may be retried later.

## Not covered

- The web app does not look writers up yet: it does not edit offline.
- Writes before this change, archive imports and rows past retention read `unknown`.
- Several tabs or devices of one person are several ids with the same name; a reload is a new
  id.
- Project archives do not carry the rows; instance backups do, like `board_restore`.
