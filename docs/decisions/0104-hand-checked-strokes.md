# 0104 — Strokes checked by hand, like their schema

Status: accepted.

## Context

After decisions 0094 and 0100 edits are fast; opening is not. On the medium reference board
(decision 0093) a recent phone opened synchronously in 2.5 s and a 2017 phone in 12.2 s.

We measured where an open goes with Node without a JIT, the proxy for Hermes (medium board,
`bench:reads`, medians): `applyUpdate` 0.88 s; the first read 2.29 s, of which Zod on pen strokes
2.07 s (frames 1.35 s, set plans 0.72 s), every other part of every card 15 ms, table rows 4 ms;
the index 1 ms. A stroke costs about 60 µs in Zod without a JIT, and the board has about 30,000.
With a JIT the split is the same at a smaller scale (strokes about 230 of 250 ms).

## Decision

`fast-items.ts` checks a `Stroke` or a `PlanStroke` the way its Zod schema does and returns what
the schema returns: the same keys in the same order, present optional keys kept even when
undefined, unknown keys left out, a copy of the points. It accepts only plain objects (prototype
`Object.prototype` or null) holding values Zod accepts; for anything else it answers UNSURE and
`readElement` runs the Zod schema, which stays the authority. So every failure is Zod's, and the
check only ever speeds up items Zod would accept. Every read goes through it: the web app, the
server's `validateBoardDoc` and every client.

Rows, shapes, icons and the rest of a card keep Zod: together they cost under 20 ms on the
medium board, not worth a second implementation of their schemas.

Tests:

- a differential test against Zod, with and without its compiled path, on valid strokes and on
  adversarial ones (odd values at every limit, boxed numbers and strings, typed arrays, sparse
  and oversized points, inherited fields, own `__proto__` keys, null-prototype objects, other key
  orders, extra keys): whatever the check accepts, Zod accepts and returns deeply equal, key
  order and present-undefined keys included;
- a pin of both schemas' full definitions (types, checks, limits, patterns, refine bodies): any
  change to `Stroke` or `PlanStroke` fails it with a message to change `fast-items.ts` the same
  way first.

## Consequences

- Without a JIT the medium board's first read drops from about 2.3 s to 0.19 s; `applyUpdate`
  (about 0.87 s) is now most of an open. With a JIT validation drops from 258 to 35 ms. Edits
  and the strict check of decision 0101 are unchanged. Numbers are in the pull request.
- `bench:reads` prints a second table that breaks an open down: `applyUpdate`, validation, the
  index alone, the synchronous store, the opt-in hydration (total and longest blocking slice)
  and the first stroke after an open.
- A change to `Stroke` or `PlanStroke` must change `fast-items.ts` too; the pin makes it
  impossible to forget.
