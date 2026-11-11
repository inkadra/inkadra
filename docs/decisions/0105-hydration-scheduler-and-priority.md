# 0105 — Hydration with a scheduler, a priority and a progressive view

Status: accepted.

## Context

Decision 0100 added `BoardStore.hydrate(doc, { budgetMs })`, which reads a board cooperatively
and pauses with `setTimeout(0)`. On React Native such a pause waits about a frame, so a chunked
open took longer than a synchronous one (six times on the small reference board), and a host had
no way to read the cards in view first. After decision 0104 the first read is cheap enough without
a JIT (0.19 s on the medium reference board) that the pauses dominate.

`Y.applyUpdate` (about 0.87 s without a JIT on the medium board) cannot be split, and we measured
what a host could do instead: re-encoding a loaded document with garbage collection gives the same
7.45 MB, the v2 encoding is 3% smaller and applies in the same time, and an update split by client
with `Y.diffUpdate` applies in 5 to 34 times the total, its parts waiting as pending structs that
Yjs merges again at every apply. So there is no helper; `docs/opening-boards.md` tells hosts to
apply once, keep the document alive between screens and fetch only the difference. The server and
the protocol are unchanged.

## Decision

`BoardStore.hydrate(doc, options)` takes, besides `budgetMs`:

- `schedule`: a function returning a promise, called when a slice starts; the next slice starts
  once it resolves and the budget is spent. The default stays `setTimeout(0)`. A rejection ends
  hydration like any other error; it is never an unhandled rejection, even when hydration finished
  without awaiting it. `destroy()` stops hydration and settles `whenHydrated` even while the
  scheduler never resolves.
- `priority`: keys, or a test on each stored card (evaluated within the budget), read first. The
  columns and scenes that hold them, by their stored `parent`, are read with them so they can be
  drawn where they are.
- `progressive` (off by default): when every priority card and container is read and current, the
  store publishes a snapshot of **only those**, each the result of `readElement` on the card as it
  is now. A change to one of them reads it again at once and publishes again; a change to any
  other card only marks it to be read again, as in 0100. The complete snapshot replaces it when
  every card is read; `hydrating` stays true until then and `canvas-core` helpers keep reading the
  document. If hydration fails after it was published, it is withdrawn: the store shows nothing,
  as when hydration fails without it.

The budget is checked between the steps of `readElementSteps` (one list item, one nested Yjs field);
plain fields are copied between steps rather than one per step, which halves the steps of a card
without a list. Whether every priority card is read is a counter, not a scan. The synchronous
constructor is unchanged.

## Consequences

- With `setImmediate` as the scheduler, hydration of the medium board without a JIT takes about
  14% longer than the synchronous read and no slice exceeded about 16 ms (numbers in the pull
  request; `bench:reads` reports total and longest slice with the default and an immediate
  scheduler). GC pauses still show as occasional longer gaps.
- A card shown progressively is always validated and current; tests check it after every pause and
  every notification, through remote edits that make a shown card invalid and valid again, and
  check the withdrawal after a failure.
- A container shown progressively holds only the priority cards inside it until the complete
  snapshot arrives; a card moved into a container that is not a priority card during hydration is
  not drawn until then.
