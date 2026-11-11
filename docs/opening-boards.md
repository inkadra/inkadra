# Opening a large board in a client

How an app that hosts the shared core (`doc-schema`, `canvas-core` and a `BoardStore` like the web
app's) opens a board without freezing, above all on phones without a JIT. The reasons and the
numbers are in decisions [0104](decisions/0104-hand-checked-strokes.md) and
[0105](decisions/0105-hydration-scheduler-and-priority.md); the reference boards and the benchmark
in [testing/reference-board.md](testing/reference-board.md).

An open has two parts: `Y.applyUpdate` of the stored document, then the first read, which
validates every card (the trust boundary of decision 0094) and builds the index.

## 1. Apply the document

`Y.applyUpdate` is one block of work that cannot be split: on the medium reference board it takes
about 0.9 s on a desktop without a JIT and 0.8 s on a recent phone. We measured what a host could
do about it and none of it helps:

- **Re-encoding with garbage collection** (`Y.encodeStateAsUpdate` of a loaded document, `gc` on)
  gives the same bytes: a document from the server is already collected.
- **The v2 encoding** (`encodeStateAsUpdateV2` / `applyUpdateV2`) is 3% smaller and applies in
  the same time.
- **Splitting the update by client** (`Y.diffUpdate` against a state vector that leaves out the
  other clients) and applying the parts with pauses in between gives the same document only once
  every part is in, and costs 5 to 34 times more in total: parts whose structs depend on other
  parts wait as pending updates that Yjs merges again at every apply.

So apply the stored document once, where a pause does no harm: keep the `Y.Doc` of a board alive
while the person moves between its screens, apply it before navigating (behind the opening
transition), and fetch only the difference from the server afterwards (the sync protocol already
sends just what the local copy lacks).

## 2. Read the cards

`BoardStore.hydrate(doc, options)` reads cooperatively and publishes the validated snapshot when
every card is read; the constructor stays synchronous. Options:

| Option        | Use                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budgetMs`    | Work per slice, default 8 ms. A slice ends after the step that crosses it: one stroke, one row or one nested field.                                                                             |
| `schedule`    | How to give the thread back, default `setTimeout(0)`. On React Native pass `() => new Promise((r) => setImmediate(r))`: a timeout there waits about a frame. Never an already resolved promise. |
| `priority`    | Keys of the cards to read first, or a test `(key, map) => boolean` (for instance the cards whose stored `x`/`y` fall in the viewport). Their columns and scenes come with them.                 |
| `progressive` | Publish, once the priority cards are read, a snapshot of those cards only, kept current; the complete snapshot replaces it. `hydrating` stays true.                                             |

A progressive snapshot never holds a card that is not validated and current: each card in it is
the result of `readElement` on the card as it is now, read again at once when it changes. Cards
that are not in the priority list appear only with the complete snapshot; a column or a scene that
holds a priority card is read and shown with it, holding only the priority cards for now. If
hydration fails (`whenHydrated` rejects, `hydrationError` says why) the progressive snapshot is
withdrawn and the store shows nothing. A `schedule` that rejects ends hydration that way; one that
never resolves stops it until `destroy()`, which also settles `whenHydrated`. Helpers of
`canvas-core` read the document, not the store, until hydration ends.
