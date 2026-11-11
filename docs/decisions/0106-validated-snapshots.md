# 0106 — Validated snapshots

Status: proposed.

## Context

After decision 0104, the first read of the medium reference board takes about 0.19 s without a
JIT; most of it validates cards that have not changed since the last open on the same device. A
phone app keeps a local copy of each board and opens the same document again and again.

## Decision

`store.exportValidatedSnapshot(build)` saves the validated view as text, and
`new BoardStore(doc, { snapshot: { text, build } })` or `BoardStore.hydrate(doc, { snapshot })`
take a card's saved read instead of validating it, when all of this holds:

- **The same build.** `build` is the host's identity of the build: its app version and commit, or
  for the web the bundle hash. It is written in the header and must be equal when the snapshot is
  opened. Rules that the schema does not show in its JSON form (refines such as a crop's bounds,
  the protocols a link's URL may use, everything behind a transform: frame shapes, the plan's
  strokes, shapes and icons) and the reading code itself change only with a build, so a snapshot
  never outlives the code that validated it. The schema version, a hash of `Element`'s JSON
  schema and a reader version stay in the header as a second, weaker check.
- **The same board**: `meta.boardId`, also in the header. On a board without one, only the
  fingerprints bind the cards.
- **The same card**: a fingerprint of the ids of the Yjs items the card is made of that are not
  deleted, through its nested types (rows and their cells), its rich text left out as reads do.
  Map entries are taken in key order and runs of one client's consecutive clocks count once, so a
  card has the same fingerprint live, reloaded or rebuilt update by update, whatever order two
  clients added its keys in. It is a 64-bit hash keyed by a random key drawn for each snapshot and
  stored in its header.
- **A well-formed text**: a header that matches, as many cards as it says, no repeated key, every
  line a key, a 64-bit fingerprint and either null or an object whose `type` this build knows and
  whose `id` is an element id. Anything else and the snapshot is ignored as a whole.

A card whose fingerprint differs is read and validated as usual. Reads that JSON would not give
back unchanged (an undefined value, a negative zero) are not saved.

**What a snapshot can make the store do:** show, for a card made of the same items, the read this
build validated when it saved the snapshot, until the card changes. **What it cannot:** hand out
anything this build did not validate; outlive the build; reach `readElement`, its caches or the
strict check of decision 0101, which read the stored card; or be written back. The store has no
writes of its own; every change to a card is read from the live document (a test opens a
snapshot whose line differs from the stored card and checks that the next edit and a helper that
orders by the view see and keep the document's value).

Why it is safe:

1. Only data this build validated is handed out, and only by this build: another build identity,
   schema, reader or board, or any malformed line, and the snapshot is not used.
2. A card is reused only when it is made of the same Yjs items: Yjs gives every insert a new id and
   never reuses one, so any edit, deletion, undo or replacement of the card changes the
   fingerprint and the card is validated again.
3. The text is untrusted in structure and trusted in content when its binding matches, like the
   app's own storage: whoever can write it can also write the local document. A host that cannot
   keep it private must not pass one, and must delete its snapshots when the app is updated.

Someone who serves a document whose item ids equal those of the saved cards but carry other
content (a server or client rewriting Yjs history, opened by a host that reloads from it instead of
its own copy) gets older validated reads shown for those cards: a stale view, not a validation
bypass, and the next change of such a card shows the stored one. Because the fingerprint is keyed
by a secret of each snapshot that never leaves the app's storage, someone who only edits the board
cannot aim at a card's fingerprint to keep an old read on someone else's screen. The hash is not
cryptographic; the key makes such an attack depend on outputs the attacker never sees, it does not
prove it impossible. A bit flipped inside a number of a saved read, with everything else intact,
is not detected: a checksum of the text would cost most of the gain.

## Consequences

- Without a JIT a read from a matching snapshot is about three times faster than validating with
  0104's check on the medium board (numbers in the pull request); with a JIT it gains nothing, so
  the web app does not use it. A snapshot is about 10 MB for the medium board (the validated
  strokes are the bulk), and exporting it is one block of about 0.18 s without a JIT.
- The first edit of a drawn card after an open from a snapshot checks that card's strokes once.
- An app update invalidates every snapshot: the first open of each board after it validates
  everything.
- New exports of `doc-schema`: `cardFingerprint`, `encodeValidatedSnapshot`,
  `openValidatedSnapshot`, `openValidatedSnapshotSteps`, `ValidatedSnapshot`, `SnapshotBuild`,
  `FingerprintKey`; new `BoardStore` option and method. Additive.
