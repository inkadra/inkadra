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

**Duplicate copies as stored.** Duplicating takes the selection and the cards inside its
containers from the stored maps and clones the Y.Maps within the same document, so unknown
fields, list items and note nodes go along. Deleting a plan base copies its Set into its
variants from the stored base, and only from a plan.

**Paste is a trust boundary.** The clipboard keeps `version: 1`, `elements` and `bodies`, which
older readers paste as before, and adds `source` (board id, schema version of the document, and
the server as the copying client names it; the web app gives its origin) and `cards`: as Yjs
updates, only the cards the copying build does not fully understand. A paste reads and checks
everything before it writes, in one transaction, all or nothing; a malformed clipboard (entries
that are not objects with an id, cards that do not decode, a plan base's Set with lists past the
plan's limits, items that are not objects or fields the plan does not allow) is refused and
nothing is written. The copying build cuts a base's Set to those limits, as reads do, so a Set
that grew past them by concurrent drawing still pastes.

- A card this build understands, and any card from a document that is not newer than this
  build, goes through the validated view and `addElement`, exactly as before.
- A card that does not validate, in `elements` or in `cards`, from a document that is not newer,
  is left out, and the paste says how many were (the web app shows it, with Undo only when
  something was pasted).
- A card from a newer document that this build does not understand is pasted as stored only
  when **the board it is pasted on** is of a newer schema than this build and at least as new as
  the copy's, within its lineage: the same board (`meta.boardId`), or the same server when the
  client names it in both copy and paste. The board's own version decides, never the clipboard:
  anyone can write a clipboard (a web page puts it in copied HTML), so on a board of this build's
  schema, which is every board the web app writes today, this path is closed. The card must also
  be stored as `addElement` stores the known fields (`hasStoredShape`: lists as Y.Arrays within
  their limits, plain values where values are plain) and validate. Anywhere else, or if a card
  cannot be read at all, the paste is refused: the app says to update it.

On a board of a newer schema an older build trusts a crafted clipboard more than a newer build
would: it keeps keys it cannot check, where the newer build would strip them. That is the price
of letting older clients copy what they do not understand, and a reason the server keeps the
role as the trust boundary.

## Consequences

- The web app does not call the strict check to edit: while every schema bump keeps older
  clients read-only, it only meets cards it understands. It passes its origin to copy and paste
  and shows a message when cards are left out or a paste is refused.
- For content a build understands the clipboard is as before plus `source`, about 100 bytes;
  a foreign card adds its Yjs update (a frame with 100 strokes of 200 points: 264 KB before,
  490 KB with the frame foreign).
- `older-client.test.ts` in `canvas-core` is test P11: this build against a document of a newer
  schema, simulated by storing what it does not know. `clipboard.test.ts` covers crafted and
  older clipboards.
- Cost is measured by `bench:reads` (docs/testing/reference-board.md).
