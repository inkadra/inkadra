# 0093 — A reference board with a real history

Status: accepted.

## Context

The native app prototypes (React Native with the shared TypeScript core, a Skia canvas, memory
on phones) and the work on lighter reads in `doc-schema` and `canvas-core` need a large board
to measure against. A board written in one transaction is misleading: Yjs merges its structs
into a few long runs, so it is much smaller and faster to load and to read than a board that
hundreds of sessions edited over months, with deletions, moves and interleaved inserts.

The collaboration simulation (`apps/server/src/collab-sim.test.ts`) is the place where edits
from many clients already meet, but it needs Postgres and Valkey, runs for real time and
produces a small board. It is the wrong tool to produce a file that a phone prototype loads.

## Decision

`packages/doc-schema/src/reference-board.ts` builds the board through real Yjs operations, one
transaction per gesture, from hundreds of client ids on replicas that sync after each round.
Three sizes (small, medium, large) and a seed make it deterministic. A script writes the update
(`.ybin`) and a JSON summary; [docs/testing/reference-board.md](../testing/reference-board.md)
says how to run it and what the board holds.

It lives in `doc-schema`, MPL like the schema it follows, so the native prototypes and the
benchmarks of `canvas-core` can use it without the server. The package does not export it.

## Consequences

- Benchmarks and prototypes measure the same board, and anyone can rebuild it from the seed
  instead of sharing large files.
- The generator writes through `addElement` and `tableRowMap` and its test validates the result,
  so it follows schema changes; a new element type or note node is added there by hand.
- The history is plausible, not recorded: real boards may have other mixes of operations.
