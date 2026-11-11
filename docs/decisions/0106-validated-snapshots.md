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
  stored in its header; what it hashes, and how, is below.
- **A well-formed text**: a header that matches, as many cards as it says, no repeated key, every
  line a key, a 64-bit fingerprint and either null or an object whose `type` this build knows and
  whose `id` is an element id. Anything else and the snapshot is ignored as a whole.

**The fingerprint, exactly.** The inputs are encoded as 32-bit words that can be read back in one
way only, and every word enters the hash:

- Every record starts with a tag that fixes how many words follow. A record whose numbers all fit
  in 32 bits takes its narrow tag and one word per number; otherwise its wide tag and, for every
  number, its low 32 bits then the rest (`n >>> 0`, `floor(n / 2^32)`), so client ids, clocks and
  lengths up to 2^53 enter whole. An id that is not a non-negative safe integer leaves the card
  without a fingerprint: it is never saved nor taken.
- Card: `CARD`, then `OWN client clock` (the item holding the card in the board's map) or
  `NO_OWN`, then the card's type.
- Type: `BEGIN`; for every map entry not deleted, in key order, `ENTRY client clock` and its
  content; `LIST`; for every item of its list not deleted, in order, either a run
  `RUN client first end` (consecutive clocks of one client merged, `end` exclusive) or, for a
  nested type, `NESTED client clock` and its content; `END`.
- Content: `PLAIN` for a value, `XML` for rich text (left out, as reads leave it out), or the
  nested type.
- Keys of map entries are not hashed: an item id fixes the key it was written under.
- The schema hash, in the header, uses the same words: `SCHEMA`, then a string as its length and
  its UTF-16 code units two per word.

Two 32-bit lanes absorb every word; for a given state each lane is a bijection of the word, so no
single word can be swapped for another without changing both lanes; each lane is seeded with half
of the key, and the two are crossed at the end. A first version folded client ids and clocks to
32 bits before hashing: two writers whose ids differ by 2^32 then produced the same fingerprint
under any key, and an editor could keep an old read of a card on someone's screen. Tests now pin
that case (an update by such a writer, at the same clock) and every bit of ids, clocks and lengths.
The lanes are not a standard PRF. A standard keyed hash (SipHash) in JavaScript works on 64-bit
values as pairs of 32-bit halves with several rounds per word; without a JIT we estimate (not
measured) it at several times this hash, which runs over every stroke item at each open and would
eat most of the snapshot's gain.

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
   app's own storage: whoever can write it can also write the local document. It holds the board's
   validated reads in clear and the fingerprint key, so a host keeps it in the app's private
   storage only, under server + account + board, and deletes it on sign-out, on app update, and
   when the board's local copy is deleted or replaced (`docs/opening-boards.md`). A replaced
   history, such as a restore that reuses item ids, is the one case where the same ids can carry
   other content; the host must drop the snapshot then.

Someone who serves a document whose item ids equal those of the saved cards but carry other
content (a server or client rewriting Yjs history, opened by a host that reloads from it instead of
its own copy) gets older validated reads shown for those cards: a stale view, not a validation
bypass, and the next change of such a card shows the stored one. Because the fingerprint is keyed
by a secret of each snapshot that never leaves the app's storage, someone who only edits the board
cannot aim at a card's fingerprint to keep an old read on someone else's screen: no input is
truncated, and the key makes any other collision depend on outputs the attacker never sees. That
is not a proof: the hash is not cryptographic. A bit flipped inside a number of a saved read, with everything else intact,
is not detected: a checksum of the text would cost most of the gain.

## Consequences

- Without a JIT a read from a matching snapshot is about 2.8 times faster than validating with
  0104's check on the medium board and 2.5 on the large one (numbers in the pull request; hashing
  every bit of the ids cost a little of the first version's 3.1); with a JIT it gains nothing, so
  the web app does not use it. A snapshot is about 10 MB for the medium board (the validated
  strokes are the bulk), and exporting it is one block of about 0.18 s without a JIT.
- The first edit of a drawn card after an open from a snapshot checks that card's strokes once.
- An app update invalidates every snapshot: the first open of each board after it validates
  everything.
- New exports of `doc-schema`: `cardFingerprint`, `encodeValidatedSnapshot`,
  `openValidatedSnapshot`, `openValidatedSnapshotSteps`, `ValidatedSnapshot`, `SnapshotBuild`,
  `FingerprintKey`; new `BoardStore` option and method. Additive.
