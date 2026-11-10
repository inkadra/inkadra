# 0094 — Lighter reads of a board

Status: accepted.

## Context

`readElement` turned a card into JSON and ran Zod over all of it on every read. A frame with
800 strokes was converted and validated stroke by stroke after each new stroke, a table with 500
rows after each cell, and `createElement` and the ordering helpers of `canvas-core` called
`listElements`, which reads and validates every card of the board, just to find the last `z` of
a column. On the reference board of [0093](0093-reference-board.md) (1000 cards) creating a note
took about 0.3 s with a JIT and 2.5 s without one, as Hermes runs on iOS.

## Decision

**Lists are read item by item.** For frame, image and plan strokes and table rows,
`readElement` validates each item with the item schema of `elements.ts` and remembers the
result: plain items (strokes) by object identity, since Yjs hands out the same stored object
for as long as the item lives and an edit stores a new one; Y.Map items (rows) together with the
content they had, compared on the next read. The rest of the card goes through `Element` as
before, with an empty list in place of the items, which then go back in. Strict lists still
fail the whole card on one bad item or past their limit; the plan's lenient list still drops bad
items and cuts at the limit. A test compares the result with the whole-card parse, key order
included, on the reference board and through edits with bad items.

So every item is validated once, when it is written or arrives from another client, and not on
every read. Nothing that comes from outside skips validation: an item never seen before is
always parsed, and the server still runs `validateBoardDoc` before it stores a board.

**Helpers take the BoardStore snapshot.** `canvas-core` gains `setElementView` and
`currentElements`. The web app's `BoardStore` registers its snapshot as the view of its document;
`createElement`, `moveToCanvas`, `moveIntoParent`, `moveToUnsorted`, `bringToFront`,
`sendToBack`, `addScene`, `addScenes` and `addVariant` read it instead of `listElements`. The
view answers only when it is current: no transaction open or waiting for its observers (counted
with `beforeTransaction` and `afterTransaction`, which Yjs emits after the observers), and no
card stored under a key that differs from its id. Otherwise the helpers read the document, as
inside `addFrame`'s transaction. Helpers whose result depends on the document's order
(`duplicateElements`, `copyElements`, `pasteElements`) keep `listElements`; so do the server and
every caller without a store.

`BoardStore` also compares lists by their items' identity before falling back to JSON.

## Consequences

- Adding a stroke, editing a cell and creating a card no longer cost a full read of the card or
  of the board; numbers are in the pull request and come from
  `pnpm --filter @inkadra/web bench:reads` (docs/testing/reference-board.md).
- Opening a board still validates everything once; that is the trust boundary.
- Callers must not mutate what `readElement` returns: stroke and row objects are now shared
  between reads. Nothing in the code base does.
- The remaining cost of an edit on very large boards is `BoardStore.index`, which sorts the
  canvas and every column on each change.
