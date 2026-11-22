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

The dense measurement times four rounds of that series on the same page and board, the peers
joining and leaving between them: without peers, with three, without, with three. The peers join
**after** the opens are timed, so the open time is the drawings' alone. They are not browsers:
the test process opens three Hocuspocus connections as the same account (the account's other
tabs, which the board shows as people like any other) and publishes a cursor every 50 ms, the
most the web app sends, along a seeded path over the seeded area. Each round starts once the page
draws exactly the cursors of that round. A second or third browser context would weigh more than
the page it measures on a runner.

**The dense measurement only reports for now.** Its bars come from a handful of runs, so in the
required **Canvas performance** job it fails only on what it needs to measure anything (the frames
on the board, the peers drawn, and every peer's cursor moves going up through each round), never on a bar: it writes its rounds to the job summary and a
warning for each bar passed, judged on the worse of the two rounds with peers. `PERF_DENSE_GATE=1`
makes the bars fail the test; turn it on in CI once about ten runs of `main` in a row stay within
them. The bars can be moved with `PERF_DENSE_OPEN_LIMIT_MS`, `PERF_DENSE_FRAME_AVG_LIMIT_MS` and
`PERF_DENSE_FRAME_P95_LIMIT_MS`, and the peers with `PERF_DENSE_PEERS`; the gate's with
`PERF_OPEN_LIMIT_MS`, `PERF_FRAME_AVG_LIMIT_MS` and `PERF_FRAME_P95_LIMIT_MS`.

## Measured

Best warm open, then frame average / p95, in ms, on the head of the pull request that added the
dense measurement (22 November 2026, after the change that stops remote cursor moves from
drawing the canvas again). The dense rounds ran in this order on one page:

| Run                   | Open | Peers | Pan         | Zoom        | Pan at 100 % |
| --------------------- | ---- | ----- | ----------- | ----------- | ------------ |
| Gate, CI              | 1461 | 0     | 21.9 / 33.4 | 28.1 / 49.9 | 16.7 / 16.8  |
| Dense, CI             | 1777 | 0     | 22.2 / 33.4 | 26.7 / 66.6 | 16.7 / 16.8  |
|                       |      | 3     | 23.1 / 33.4 | 34.7 / 66.7 | 16.7 / 16.8  |
|                       |      | 0     | 21.4 / 33.4 | 30.6 / 50.1 | 16.7 / 16.7  |
|                       |      | 3     | 22.2 / 49.9 | 33.6 / 83.3 | 16.8 / 16.8  |
| Gate, CI, second run  | 1149 | 0     | 16.7 / 16.7 | 19.4 / 33.4 | 16.7 / 16.8  |
| Dense, CI, second run | 1263 | 0     | 16.9 / 16.8 | 19.7 / 33.4 | 16.7 / 16.8  |
|                       |      | 3     | 16.9 / 16.7 | 23.9 / 50.0 | 16.7 / 16.8  |
|                       |      | 0     | 16.9 / 16.7 | 22.5 / 33.4 | 16.7 / 16.8  |
|                       |      | 3     | 17.5 / 33.3 | 24.7 / 50.0 | 16.7 / 16.8  |
| Gate, CI, third run   | 1080 | 0     | 16.7 / 16.8 | 19.7 / 33.4 | 16.7 / 16.8  |
| Dense, CI, third run  | 1239 | 0     | 16.9 / 16.8 | 19.4 / 33.4 | 16.7 / 16.7  |
|                       |      | 3     | 16.9 / 16.8 | 25.8 / 50.0 | 16.7 / 16.7  |
|                       |      | 0     | 17.1 / 16.8 | 20.0 / 33.4 | 16.7 / 16.8  |
|                       |      | 3     | 16.8 / 16.8 | 22.5 / 66.7 | 16.7 / 16.8  |
| Dense, dev machine\*  | 1588 | 0     | 22.4 / 49.9 | 23.1 / 50.0 | 16.7 / 16.8  |
|                       |      | 3     | 22.4 / 50.0 | 30.3 / 66.7 | 16.8 / 16.7  |
|                       |      | 0     | 21.5 / 33.4 | 26.9 / 50.0 | 16.7 / 16.7  |
|                       |      | 3     | 21.9 / 50.0 | 31.1 / 50.1 | 16.7 / 16.7  |

\* A 12-thread Linux machine shared with other work, at a quiet moment. A run there during heavy
use by other work showed no difference between the rounds (zoom 31 to 37 ms on average with or
without peers): numbers from a busy machine do not tell the peers' cost.

What they say: the drawings (3654 strokes) add about 300 ms to the open. With three moving cursors,
the mean zoom frame time showed an observed increase of about 2 to 8 ms over the rounds without
them on the same page, on CI and on the quiet dev machine, after that change; there is no
systematic difference in pan. Why the zoom still pays for them is not pinned down. Three runs are too few for bars that gate merges,
which is why the measurement only reports.

The load on the server of many people on one heavy board is the load test's `dense` scenario
([Capacity](../self-hosting/capacity.md#dense-one-heavy-board)).
