# 0101 — Strict card check and copies as stored

Status: accepted.

## Context

Reads strip what the schema does not know: `readElement` runs Zod in its default mode, so a
card written by a newer schema reads fine and its new fields are gone from the plain view. A
client that writes from that view loses them: `pasteElements` went through `Element[]` and
`addElement`, duplicating or copying a column or a scene took its cards from `listElements`,
which leaves out the cards that do not validate, deleting a plan base copied its Set from the
validated view (and nothing at all when the base did not validate), and an edit of a nested
plain value (an arrow's end, a crop) replaces the whole object. A note editor drops the nodes,
marks and attributes its ProseMirror schema does not have (decision 0074).

Today every schema bump keeps older clients read-only, so this never happens. Native apps,
updated late, will edit offline; the rule that lets an older client write is in the next
decision. It needs a way to tell the cards an older build understands from those it does not.

## Decision

**The strict check.** `checkCard(map)` in `doc-schema` compares a card as stored with the
schema of the build: keys at any depth (nested objects, Y.Maps in lists, plain list items),
values of enumerations and literals (the element type, icon kinds…), and in a note body the
nodes, marks and attributes of `NOTE_BODY_SCHEMA`, the note editor's ProseMirror schema (a web
test keeps the two equal). A card that does not validate, or a lenient list that leaves out
items, counts too. The result is `known`, or `foreign` with what was not understood and whether
the card is readable at all. It is walked from the Zod schemas, so a new field is known as soon
as it is in `elements.ts`. Results are kept per card and dropped when a transaction changes the
card or anything inside it (the bookkeeping of 0094 and 0100); plain list items are walked once
per stored object, and lists of numbers or free strings are not walked.

**A foreign card is read-only for that client.** It is shown when it is readable, and that
client does not edit, move or rewrite it. Reads keep stripping: the strict check is separate and
never changes what `readElement` returns.

**Containers.** `foreignCardsIn(doc, ids)` lists, from the stored maps, the foreign and the
unreadable cards an operation on `ids` takes along: the cards, the cards inside the columns and
scenes among them, the variants of the plans among them. A client refuses, or asks, before it
deletes or copies them.

**Copies as stored.** Duplicate, copy and paste take the selection and the cards inside its
containers from the stored maps and copy the Y.Maps, so unknown fields, list items and note
nodes go along. The clipboard keeps `version: 1`, `elements` and `bodies` for older readers and
adds `cards`, each copied card as a Yjs update; readers that know it paste from it alone and
check each card with `readElement`, as `addElement` checks the elements of an older clipboard.
A clipboard holding a card that does not validate is refused as a whole. Placement, ids,
z-order and links (arrow ends, a to-do list's scene, a plan's scenes and base) are those of the
paste of elements; an arrow end keeps its other fields. Deleting a plan base copies its Set
into its variants from the stored base.

## Consequences

- The web app does not call the strict check yet: while every schema bump keeps older clients
  read-only, it only meets cards it understands. Its copies and pastes of known content are as
  before; a clipboard now also carries `cards`, which roughly doubles its size.
- A card that does not validate is now copied with its column; pasting such a clipboard is
  refused instead of leaving the card out.
- `older-client.test.ts` in `canvas-core` is test P11: this build against a document of a newer
  schema, simulated by storing what it does not know.
- Cost is measured by `bench:reads` (docs/testing/reference-board.md).
