# Canvas performance

`pnpm test:perf` (after `pnpm build`, with Postgres and Valkey as for the end-to-end tests) runs
`e2e/tests/perf/canvas-perf.spec.ts` in headless Chromium. CI runs it on every pull request (job
**Canvas performance** of `ci.yml`) and keeps `e2e/perf-results.json` as an artifact. Two
measurements, each on a board seeded through the API and the collaboration server
(`e2e/tests/perf/seed.ts`):

| Measurement | Board                                                                                                                       | Others on it                             | Bars (warm open · frame average · frame p95) |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Gate 0.2    | 1000 cards: 20 columns of notes, about 520 images (50 pictures), notes, to-dos, links                                       | nobody                                   | 2500 · 40 · 70 ms                            |
| Dense       | the same 1000 cards, 8 of them storyboard frames drawn with 300 to 600 pencil strokes each (about 3600 strokes, fixed seed) | 3 peers moving their cursors every 50 ms | 4000 · 60 · 120 ms                           |

Each opens the board four times (the first, cold, is recorded but not judged; the best of the
other three is), then times frames while panning over the whole board, zooming, and panning at
100 %. Frames are drawn on the CPU (no GPU on a runner), so the bars catch regressions, not the
60 fps of a real browser. The gate also records the same series with the floating glass's blur
on, not judged. The comments in the spec say where its bars come from.

The peers are not browsers: the test process opens three Hocuspocus connections as the same
account (the account's other tabs, which the board shows as people like any other) and
publishes a cursor every 50 ms, the most the web app sends, over the seeded area. The test waits
until the page draws their three cursors before it times anything. A second or third browser
context would weigh more than the page it measures on a runner.

The bars of the dense measurement can be moved with `PERF_DENSE_OPEN_LIMIT_MS`,
`PERF_DENSE_FRAME_AVG_LIMIT_MS` and `PERF_DENSE_FRAME_P95_LIMIT_MS`, and the peers with
`PERF_DENSE_PEERS` (0 times the drawings alone); the gate's with `PERF_OPEN_LIMIT_MS`,
`PERF_FRAME_AVG_LIMIT_MS` and `PERF_FRAME_P95_LIMIT_MS`.

## Measured

Best warm open, then average / p95 of the frames, in ms (22 November 2026):

| Run                    | Open | Pan     | Zoom    | Pan at 100 % |
| ---------------------- | ---- | ------- | ------- | ------------ |
| Gate, CI               | 1333 | 21 / 33 | 24 / 33 | 17 / 17      |
| Dense, CI              | 1657 | 20 / 33 | 30 / 67 | 17 / 17      |
| Gate, dev machine\*    | 1427 | 24 / 50 | 23 / 33 | 17 / 17      |
| Dense, dev machine\*   | 1758 | 24 / 50 | 37 / 67 | 17 / 17      |
| Dense, dev machine\*   | 1838 | 27 / 50 | 38 / 83 | 17 / 33      |
| Dense, no peers, dev\* | 1704 | 22 / 50 | 24 / 50 | 17 / 17      |

\* A 12-thread Linux machine shared with other work.

The drawings cost about 300 ms of the open (3654 strokes). The peers cost the zoom: with the
drawings alone it stays as smooth as the gate's (24 ms on average), with three cursors moving it
takes 30 to 38 ms on average and 67 to 83 ms at p95. Judged by the gate's 70 ms bar, that would
fail now and then, which is why the dense measurement has bars of its own. Why three moving
cursors cost the zoom this much is not pinned down yet.

The load on the server of many people on one heavy board is the load test's `dense` scenario
([Capacity](../self-hosting/capacity.md#dense-one-heavy-board)).
