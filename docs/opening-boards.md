# Opening a large board in a client

How an app that hosts the shared core (`doc-schema`, `canvas-core` and a `BoardStore` like the web
app's) opens a board without freezing, above all on phones without a JIT. The reasons and the
numbers are in decisions [0104](decisions/0104-hand-checked-strokes.md),
[0105](decisions/0105-hydration-scheduler-and-priority.md) and
[0106](decisions/0106-validated-snapshots.md); the reference boards and the benchmark in
[testing/reference-board.md](testing/reference-board.md).

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
| `snapshot`    | A validated snapshot saved by an earlier open of this build, with the build identity (below).                                                                                                   |

A progressive snapshot never holds a card that is not validated and current: each card in it is
the result of `readElement` on the card as it is now, read again at once when it changes. Cards
that are not in the priority list appear only with the complete snapshot; a column or a scene that
holds a priority card is read and shown with it, holding only the priority cards for now. If
hydration fails (`whenHydrated` rejects, `hydrationError` says why) the progressive snapshot is
withdrawn and the store shows nothing. A `schedule` that rejects ends hydration that way; one that
never resolves stops it until `destroy()`, which also settles `whenHydrated`. Helpers of
`canvas-core` read the document, not the store, until hydration ends.

## 3. Save a validated snapshot

After an open, when the app is idle, save `store.exportValidatedSnapshot(build)` (a string; null
while it cannot be exported) next to the local copy of the document, and pass
`{ snapshot: { text, build } }` to the next open of the same board. `build` is the app's build
identity, the same for both calls: its version and commit (for the web, the bundle hash). Cards made
of the same Yjs items take the validated read of that time instead of being validated again; cards
that changed are read as usual; a snapshot of another build, board or schema, or a malformed one,
is ignored as a whole.

**What it contains, in clear:** plain JSON with the validated read of every card of the board:
positions, texts, captions, notes of frames, table cells, strokes, links, names, everything the
card shows except a note's rich-text body; the board id; the build identity; and the snapshot's
fingerprint key. It is as sensitive as the board itself, and its key must stay secret.

**Where and how long a host may keep it:**

- Only in the app's private storage (the app sandbox on a phone; on the web, storage of the app's
  own origin), never in shared folders, removable storage, backups that leave the device, logs,
  crash reports, or anything synchronised or sent to a server or another person.
- Under a namespace of **server + account + board**, never by board id alone: the board id is not
  an identity, and two servers or two accounts can hold the same board.
- Delete it:
  - when the account **signs out** or its session is revoked (all of that account's snapshots);
  - when the app is **updated** (all snapshots: a new build ignores them, and an update must
    never be the moment an old one is trusted);
  - when the board's local copy is deleted, or **replaced** rather than merged (a restore, a reset
    from the server, a re-download): a replaced history can reuse item ids for other content, and
    the snapshot would then show reads of the old one;
  - when the account loses access to the board.
- Never open a snapshot that came from anywhere else: it is trusted like the app's own storage,
  and only its structure is checked. A bit flipped inside a saved number is not detected.

Exporting is one block (about 0.18 s on the medium reference board without a JIT): call it when
nothing else needs the thread, not at every edit. There is no size limit on the text: a host that
stores snapshots where something else could make them huge must not use them.

Without a JIT, opening the medium reference board from a matching snapshot reads the cards about
2.8 times faster than validating them; the first edit of each drawn card afterwards checks that
card's strokes once. With a JIT validating is as fast as the snapshot, so a browser does not need
one.
