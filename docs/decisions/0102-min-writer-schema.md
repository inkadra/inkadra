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
schema whose clients may still write a document of the current version. It rises only when a
change is not safe for older writers.

**Prudence by default.** `MIN_WRITER_SCHEMA` is `CURRENT_SCHEMA_VERSION` unless a change is
declared compatible, and a change is declared compatible only when a test in the style of P11
(`canvas-core/src/older-client.test.ts`) proves that a client of the older schema cannot lose
what it adds: through paste, duplicate, delete, edits of nested values and notes. Without such
a test the change raises `MIN_WRITER_SCHEMA` with the version, and older clients are read-only,
as today. Better read-only than damaged.

**What a compatible change may be.** Additions only: an optional field, an enumeration value, an
element type, a note node or mark, that an older build either keeps through the copies of
decision 0101 or reads as a foreign card. Removing or renaming, a tighter constraint on existing
data, a new meaning for an existing field, anything an older client would rewrite: not
compatible.

**Migrations never rewrite what an offline client can touch.** A migration that a compatible
change needs may add what is missing; it never moves, renames or rewrites fields or cards that
an older client may be editing offline. A migration that must do so is not compatible.

**The strict check is mandatory for every client that writes below the current version.** A
client may write a document of a newer schema only if it runs the strict per-card check of
decision 0101 on every card it edits, copies or deletes, and on the cards containers take along
(`foreignCardsIn`). A foreign card is read-only for that client: shown when readable, never
edited, moved or rewritten; operations that would copy or delete foreign or unreadable cards
are refused or confirmed explicitly. A client without the check treats any newer document as
read-only, whatever `minWriterSchema` says. The web app has no such check yet:
`watchDocumentSchema` keeps it read-only on any newer document (its `checksCards` is off).

**Blocked edits are never discarded.** A client that becomes read-only (a too-old schema, a
foreign card) keeps what it could not send in its own log and sends it after the update of the
app, when the server accepts it, or shows it to the person; it never deletes it silently.

**Where it is applied.**
- The collaboration server takes `MIN_WRITER_SCHEMA` (a test can lower it) and uses it in its
  three checks: at authentication, at the periodic access recheck and on every change. A client
  with `schemaVersion >= minWriterSchema` may write; a document a newer client upgraded keeps
  its own version as the minimum, as before.
- When it is lower than `schemaVersion`, the server records it in the document as
  `meta.minWriterSchema` on load, so a client sees, also offline, which schemas may write the
  document it holds (`getMinWriterSchema`); nothing is recorded while it equals the version.
  The server never trusts the value in a document: it compares with its own.
- `GET /api/v1/instance/version` returns `minWriterSchema` beside `docSchemaVersion`, with the
  capability `min-writer-schema`.

## Consequences

- Nothing changes today: `MIN_WRITER_SCHEMA` equals `CURRENT_SCHEMA_VERSION`, no document gets
  `minWriterSchema`, and every older client is read-only as before. `collab-writers.test.ts`
  runs the server with a lowered minimum: a client of that schema writes (also offline edits,
  sent when it connects), an older one stays read-only.
- Lowering `MIN_WRITER_SCHEMA` for a change needs its P11 test in the same pull request, and is
  a `contract` change.
- The web app must run the strict check before it turns `checksCards` on; until then a web tab
  of an older build stays read-only on a newer document.
