# 0142 · Cards put back only if they are absent

Accepted, 2026-11-28. Builds on [0101](0101-strict-card-check.md) (how a copy is read),
[0120](0120-board-writers.md) (who wrote under which client id),
[0139](0139-collaborative-update-checks.md) (the checks of a client update) and
[0141](0141-scene-data-follows-moved-scenes.md) (card data that moved).

## Context

A client can keep a copy of cards that were deleted (the mobile app keeps them on the device) and
offer to put them back under their own ids, so that their comments, reviews and links find them
again. Written by the client as a plain Yjs set, the check that a card is absent runs on the
client's copy of the board only. If someone else already put the same card back on the server (an
Undo, a version restore) and that has not reached the client yet, both writes set the same key of
`elements`: Yjs keeps one value per key, chosen by client id, and the server drops the other when
it collects garbage. One person's card is lost without anyone being told.

## Decision

1. **A request on the board's own connection.** A client sends the stateless message
   `restoreCards` (`{ type, requestId, clipboard, at }`, JSON text) on the Hocuspocus connection of
   the board. `clipboard` is what `copyElements` writes (version 1, `cards` included); `at` is
   where cards whose column or scene is not on the board go. Hocuspocus handles a connection's
   messages in order, so every update the client sent before the request is on the board when the
   server reads it: a card put back into a column the client made just before lands in it.
2. **Checked and written in one step.** The server answers only with the connection's own write
   rights (role, schema of 0102, a frozen or full board of 0130, a process handing its boards over
   of 0138), refuses cards whose data moved to another board (0141), and writes the cards in a
   scratch copy of the board with `restoreElements` (canvas-core) under a client id nobody wrote
   under. The difference gets the checks a client update gets (0139, the caps, task assignments).
   From the last check to the write there is no await: every other update of the board is wholly
   before the check or wholly after the write. So two requests for the same cards, or a request
   and any update already on the server, can never both put them back: the second reads
   `present`. The write is applied as an edit of that connection and goes to every client of the
   board as an ordinary update; the answer goes to the requesting connection alone, after the
   update was sent, though a client must not rely on that order.
3. **Answers** (`restoreCardsResult`, `readRestoreCardsResult` in doc-schema):
   - `restored`, with `ids` (the cards not inside another card of the copy), `outside` (those put
     on the canvas at `at`) and `own` (every card written, each under its own id);
   - `present`, with the cards of the copy already on the board: nothing was written;
   - `refused`, with `role`, `schema`, `frozen`, `full`, `moved`, `invalid` (a malformed request,
     or a card that does not validate: a paste leaves such a card out, a restore would lose it),
     `newer` (content of a newer schema than the server's), `tooLarge` (more than 500 cards or
     1 MiB of text) or `busy` (more than 30 requests a minute on one connection, the process is
     handing its boards over, or an error: try again later).
   A request whose `requestId` cannot be read gets no answer.
4. **A resend is safe.** A client that never got the answer sends the same request again, with the
   same `requestId`. For 15 minutes, and for the last 100 requests of a board, the server answers a
   `restored` again with `repeat: true`, writing nothing. After a restart of the process it reads
   `present` instead: the client then keeps its copy, possibly redundant, never lost.
5. **Attribution.** The restore's client id is recorded as the requester's (0120), not the
   server's, so naming who wrote a card names the person who put it back.
6. **Feature detection.** Servers that answer advertise `conditional-restore`
   (`CONDITIONAL_RESTORE_CAPABILITY` in packages/shared) on `GET /instance/version`. Hocuspocus
   ignores a stateless message nobody handles, so a client never sends the request without the
   capability; it does not depend on the document schema. Clients that never send it see the
   restored cards as an ordinary update. The messages are not board notices: `readBoardNotice`
   does not read them.
7. **Shared rules in MPL packages** (0116): `restoreElements` and `RestoreRefusedError` in
   canvas-core read a copy as a paste does (0101) but keep the ids, refuse the whole copy when a
   card of it is on the board (a card deleted since counts as absent), keep every field as copied,
   and put on the canvas only a card whose column or scene is neither in the copy nor on the
   board. Requests and answers are zod schemas in doc-schema.

## Not covered

A plain Yjs write of the same card key that reaches the server **after** the restore (made
offline on another device, by an Undo there, or by a client without the capability that restores
on its own) is still settled by Yjs, and one of the two values is lost: no server check can come
before a write it has not received. It needs the same card deleted by two people and brought back
by both, one of them offline or in flight. The upgrade is for the server to keep the losing value
of a concurrent re-set of a card key; that needs its own decision (where the kept card lives, how
clients show it, a hook on every update).

The web app's Undo of a delete does not use the request yet: it is online, and its window is a
few milliseconds.

## Consequences

- `packages/doc-schema` gains `RestoreCardsRequest`, `RestoreCardsResult`, `RestoreRefusal`,
  `readRestoreCardsRequest`, `readRestoreCardsResult`, `RESTORE_CARDS_MAX` and
  `RESTORE_CARDS_MAX_LENGTH`; `packages/canvas-core` gains `restoreElements`, `RestoreResult` and
  `RestoreRefusedError`; `packages/shared` gains `CONDITIONAL_RESTORE_CAPABILITY`.
- No schema change, no migration, no new endpoint. Each request costs one copy of the board in
  memory; boards are capped (0130) and requests are rare.
- Each restore adds one client id to the board's state vector and one row of 0120.
