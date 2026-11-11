# 0102 — Schema compatibility: minWriterSchema

Status: accepted. Amends [0004](0004-data-split.md): the board document schema does not freeze
at 1.0.

## Context

The board document carries `schemaVersion`. A client tells the collaboration server the schema
it knows (`?schemaVersion=`); a client that knows less than the document is read-only, its
updates are answered without being applied. Every change of the schema, even an optional field
nobody has to fill, bumps the version, so after every release every older client is read-only,
including the edits it made offline. That is what kept data safe: an older build that writes
loses what it does not know (decision 0101).

Installed apps update late, and the schema keeps growing after 1.0. Freezing it would stop the
product; bumping as today would make every app release a read-only day for everyone who has not
updated, offline work included.

## Decision

**Two numbers.** `schemaVersion` (`CURRENT_SCHEMA_VERSION`) still rises with every change of the
document, with its migration. `MIN_WRITER_SCHEMA`, beside it in `doc-schema`, is the oldest
schema whose clients may still write a document of the current version, if they run the strict
card check. It is lower than the version only when a change is proven safe for older writers.

**Prudence by default, mechanically.** `WRITER_SCHEMAS` in `doc-schema` lists, for each schema
version from 22 on, the oldest writer schema proven safe for it and the test that proves it;
`MIN_WRITER_SCHEMA` is the entry of `CURRENT_SCHEMA_VERSION`. Every bump adds its own entry,
which is its own version (`{ 23: { min: 23 } }`) unless a test in the style of P11
(`canvas-core/src/older-client.test.ts`) proves that a client of the older schema cannot lose
what the change adds, through paste, duplicate, delete, edits of nested values and notes; then
the entry names that test by its title, which starts with the pair it proves
(`{ 23: { min: 22, proof: 'schema 23 from 22: …' } }`). A unit test fails when the current
version has no entry, or when an entry is lower than its version without a test of that file
whose title starts with that very pair. So a bump never inherits the minimum of the version before it.
Better read-only than damaged.

**What a compatible change may be.** Additions only: an optional field, an enumeration value, an
element type, a note node or mark, that an older build either keeps through the copies of
decision 0101 or reads as a foreign card. Removing or renaming, a tighter constraint on existing
data, a new meaning for an existing field, anything an older client would rewrite: not
compatible.

**Migrations never rewrite what an offline client can touch.** A migration that a compatible
change needs may add what is missing; it never moves, renames or rewrites fields or cards that
an older client may be editing offline. A migration that must do so is not compatible.

**The strict check is mandatory, and declared.** A client may write a document of a newer
schema only if it runs the strict per-card check of decision 0101 on every card it edits,
copies or deletes, and on the cards containers take along (`foreignCardsIn`). A foreign card is
read-only for that client: shown when readable, never edited, moved or rewritten; operations
that would copy or delete foreign or unreadable cards are refused or confirmed explicitly. The
server cannot see the check, so the client declares it when it connects: `strictCards=1` next to
`schemaVersion`. A client that does not declare it writes only at the current schema, whatever
the minimum: a web tab already open never becomes a writer of a newer document because a
release lowers the minimum. The web app declares nothing.

**Blocked edits are never discarded**: required of every client that declares the strict check.
Such a client keeps what it could not send in its own log, sends it after the update of the app,
when the server accepts it, or shows it to the person; it never deletes it silently. The web app
of today keeps its unsent edits as before and shows the update notice.

**Where it is applied.**
- The collaboration server takes `MIN_WRITER_SCHEMA` (a test can lower it). At authentication,
  at the periodic access recheck and on every change, a client may write when its
  `schemaVersion` is at least the current schema, or at least `MIN_WRITER_SCHEMA` and it declared
  `strictCards=1`. A document a newer client upgraded needs that client's schema, as before; at
  authentication the server also looks at the document if it is already open.
- When a read-only connection sends changes, the server answers, once per reason, with the
  stateless notice `writeRefused`: `role` to a client that may not edit, whatever else holds the
  board; otherwise `frozen`, or `schema` with the `schemaVersion` this client would need (update
  the app). A client tells "update the app" from the rest by it. The server decides from the
  update's clocks and the document's state vector, never by walking the document, and not again
  once it has told the connection.
- Nothing is stored in the document: the minimum always comes from the server's table, so it
  cannot be stale or forged. A client that holds a newer document offline learns whether it may
  write it from `GET /api/v1/instance/version`, which returns `minWriterSchema` beside
  `docSchemaVersion` (the pair: the minimum is for that version only), with the capability
  `min-writer-schema`, or from the server when it connects.

## Consequences

- Nothing changes today: `MIN_WRITER_SCHEMA` equals `CURRENT_SCHEMA_VERSION`, and every older
  client is read-only as before. `collab-writers.test.ts` runs the server with a lowered minimum:
  a client of that schema writes only if it declares the strict check (also its offline edits,
  sent when it connects), the others and older ones stay read-only and are told why.
- Lowering the minimum for a change needs its P11 test in the same pull request, an entry in
  `WRITER_SCHEMAS` naming it, and is a `contract` change.
- The web app must run the strict check before it declares it; until then a web tab of an older
  build stays read-only on a newer document. `watchDocumentSchema` takes the advertised pair for
  clients that do.
