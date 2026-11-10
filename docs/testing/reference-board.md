# Reference board

A board document with a realistic Yjs history, for performance work on the web app and the
native prototypes (decision [0093](../decisions/0093-reference-board.md)). Dev and test tooling
only: `packages/doc-schema/src/reference-board.ts` is not exported by the package, so no app
bundles it.

```sh
pnpm --filter @inkadra/doc-schema reference-board --size medium --seed 1 --out <folder>
```

`--size` is `small`, `medium` (default) or `large`, `--seed` any integer (default 1), `--out` the
folder to write to (default `packages/doc-schema/reference-boards/`, ignored by git). The same
size and seed always give the same bytes. It writes:

- `reference-board-<size>-<seed>.ybin`: `Y.encodeStateAsUpdate` of the board, to load with
  `Y.applyUpdate`;
- `reference-board-<size>-<seed>.json`: counts by element type, strokes per drawn card, rows of
  the table, update size in bytes, the history (operations by kind, sessions, client ids) and the
  ids benchmarks edit (`bench.frameId`, a frame with exactly 800 strokes, and `bench.tableId`).

| Size   | Elements | Drawn cards (strokes each) | Rich notes | Table rows | Sessions | Update  | Time on the workstation |
| ------ | -------- | -------------------------- | ---------- | ---------- | -------- | ------- | ----------------------- |
| small  | 200      | 6 (60–120)                 | 10         | 100        | 60       | 0.3 MB  | 0.2 s                   |
| medium | 1000     | 30 (500–1000)              | 50         | 500        | 400      | 7.5 MB  | 6 s                     |
| large  | 3000     | 60 (500–1000)              | 150        | 500        | 1000     | 14.9 MB | 34 s                    |

## How it is built

Eight replicas (devices) edit at the same time; every session on a replica takes a new
`clientID`, as a reload of the web app does, and the replicas exchange their updates after each
round of sessions, so edits interleave and merge as they do through the collaboration server.
Each gesture is its own transaction, through the same helpers as the apps (`addElement`,
`tableRowMap`): cards created, moved, resized, restacked, moved in and out of columns and
deleted (a column with its cards); strokes drawn and erased on frames and set plans; table rows
inserted, deleted and edited cell by cell; note bodies typed into with paragraphs, task lists,
mentions, pictures and the ink mark. A last session brings every count to its target.

The medium board has about 42,000 operations, of which about 10,800 create, move or delete
cards, by about 400 client ids. `reference-board.test.ts` checks that the small board validates
with `validateBoardDoc` and has the counts of its size.

## Benchmark of the reads

`apps/web/scripts/bench-reads.ts` loads the medium and large boards from the default folder and
times, with the web app's `BoardStore` attached: opening (`Y.applyUpdate`, then the first full
read), adding a stroke to the frame with 800 strokes, editing a table cell and `createElement`
(medians; decision [0094](../decisions/0094-lighter-core-reads.md)).

```sh
pnpm --filter @inkadra/doc-schema reference-board --size medium
pnpm --filter @inkadra/doc-schema reference-board --size large
pnpm --filter @inkadra/web bench:reads
# Without a JIT, as Hermes on iOS; --zod-jitless also turns off Zod's compiled fast path
cd apps/web && node --jitless --import tsx scripts/bench-reads.ts --runs 15 --zod-jitless
```
