# Capacity

How many people can work on one Inkadra instance at the same time depends on the machine, the
database and the boards. The load test measures it for your setup: it connects editors and
readers to an instance, the way the web app does, and reports how long edits take to come back,
how long boards take to save and how much each open board weighs.

> **Run it against a test copy of your instance, never production.** It creates an account, a
> project with up to a thousand boards and small uploads, and puts real load on the server, the
> database and Valkey for several minutes: everyone on the instance would feel it. It deletes
> what it created at the end, also when stopped with Ctrl-C, but a crash or a lost connection
> can leave a project named `Load test …` behind.

Administrators can also run it from **Settings → Server → Load test**, on the instance itself
and with protections: see [From the settings](#from-the-settings).

## Presets

| Preset             | Editors | Readers | Boards | Duration | Edit round trip p95 / p99 | Board save p95 | Peak memory\* |
| ------------------ | ------- | ------- | ------ | -------- | ------------------------- | -------------- | ------------- |
| `small`            | 5       | 2       | 50     | 1 min    | 500 / 1500 ms             | 1000 ms        | 1 GiB         |
| `medium` (default) | 20      | 4       | 200    | 3 min    | 750 / 2000 ms             | 1500 ms        | 1.5 GiB       |
| `large`            | 50      | 10      | 1000   | 5 min    | 1500 / 4000 ms            | 3000 ms        | 3 GiB         |

\* Of the processes that hold boards (`all`, or `collab` in split mode).

Every preset also fails on any error (a refused connection, a board that does not open, a failed
upload), on more reconnects than editors, on open board documents over 256 KiB each on average, on
more than 8 MiB of memory growth per open board where that number is meaningful (see
[Reading the report](#reading-the-report)), and on a slow wait for a database connection (1, 2
and 5 s). The limits are generous on purpose: they catch a
regression of several times on a shared CI machine, not a few percent. They live in
[`apps/server/src/loadtest/report.ts`](../../apps/server/src/loadtest/report.ts).

What the clients do: the test seeds the boards through the API, with 20 notes each. Each editor
opens a random board, adds a note, then moves it about once a second while moving its cursor,
uploads a small picture about once a minute, and moves to another board every 20 to 40 seconds.
Each reader follows an editor from board to board without writing.

## Dense: one heavy board

The presets spread people over many light boards, about one editor per board. `--preset dense`
is the other shape, the riskiest for one collaboration process: **15 editors and 3 readers on
the same board**, a heavy one, then everyone dropping and coming back at once.

```sh
METRICS_TOKEN=<the token of the instance> \
pnpm loadtest --preset dense --url https://inkadra-test.example.com --yes-i-know
```

- **The board** is the medium [reference board](../testing/reference-board.md) (decision 0093):
  1000 cards with a real editing history by about 400 sessions, 20 storyboard frames and 10 set
  plans drawn with 500 to 1000 strokes each (15,130 strokes on the frames), notes with rich text,
  a table of 500 rows; about 7.3 MB encoded. It takes a few seconds to build on the machine
  running the test, then one client sends it to the board.
- **The editors** arrive within 3 seconds. Each adds a note and then, once a second, moves it or
  (one time in five) draws a pencil stroke on a frame, and moves its cursor every 50 to 100 ms
  the whole time. That is a sustained stress, not typical use: the web app sends a cursor at most
  every 50 ms, and only while the pointer moves. The readers are connections of the same account
  that only observe, and time how long the editors' changes take to reach them. All of it is
  seeded (`--seed`, printed in the report); only ids are random.
- **What is timed.** The edit round trip of each edit, from the change until the server
  acknowledged that update (a connection's updates are acknowledged in order); an edit still not
  acknowledged 30 s after the run fails it, and a run with fewer timed edits than half the
  expected ones (one a second per editor) fails too. Delivery is timed for each value a reader
  received; a value overwritten before it arrived is not counted.
- **The reconnect burst** is what people go through when the collaboration role restarts: every
  connection drops; each editor moves its note and adds a marker card while offline; the test
  leaves the board alone for 15 s, the time the server takes to store it and close it; then all
  18 clients reconnect in the same instant. It measures the time until every one is synced with
  its offline changes acknowledged, then checks that they **converge**: every client and a fresh
  one hold the same document (state vector and delete set, so a deletion that reached only some
  of them counts) with every offline change on every one of them.
- **Persistence.** Then everyone leaves, and the board's preview, which the server computes from
  the document stored in PostgreSQL and never from the one in memory, must list every marker card
  (their count and their labels). A client that opens the board afterwards must get the same
  document with every offline change.
- **What it cannot see.** Whether the server really closed the board and read it back from the
  database before the clients came back: `inkadra_collab_open_boards` counts boards with people
  on them, so it reads zero as soon as everyone leaves, while the document may still be in memory,
  and nothing else outside the server tells resident documents apart. The report says so instead
  of claiming a reload. On the dev machine a temporary log line in the server showed that it did
  reload the board both at the burst and at the reopen (22 November 2026).
- **The event loop delay** is `inkadra_web_event_loop_delay_p99_seconds`, the p99 of the process
  answering `/metrics` over each 5 s between readings, the worst window of the steady run and of
  the burst apart. With `all` that process holds the board, and the numbers are limits; in split
  mode it is the web role's and only shown. On CI the load clients run on the same 4-core runner
  as the server and compete for its CPU: the number is the server's under this whole load, and
  tells neither which work nor which phase of a window caused it.
- It is CLI only: **Settings → Server** keeps the three presets.

| Limit                                  | `dense`          | Why it differs from the presets                                                          |
| -------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Edit round trip p95 / p99              | 750 / 2000 ms    |                                                                                          |
| Delivery to readers p95                | 1500 ms          |                                                                                          |
| Board save p95                         | 6000 ms          | each save writes the whole 7 MB board; the saves of the burst count too                  |
| Peak memory                            | 2 GiB            |                                                                                          |
| Board documents                        | 16 MiB           | the 256 KiB of the presets is a mean over light boards; this board starts at about 7 MiB |
| Reconnects                             | 15               |                                                                                          |
| Timed edits, unacknowledged edits      | half, 0          | new                                                                                      |
| Reconnect burst, all synced            | 30 s             | new                                                                                      |
| Event loop p99, steady / burst (`all`) | 3000 / 10,000 ms | new                                                                                      |

Also on any error, a burst that does not converge or whose changes are not stored, and a pool
wait over 2 s. Memory per open board is never a limit here (one board). The limits live in
[`apps/server/src/loadtest/dense.ts`](../../apps/server/src/loadtest/dense.ts).

## From the settings

**Settings → Server → Load test** (administrators) runs the same presets as a worker job of the
instance, so it needs Valkey (`REDIS_URL`) and a worker (`all`, or a `worker` container):

- Pick a preset, read the warning, tick the confirmation, then start now or schedule a time
  within the next 7 days, in the server's time zone (for example tonight at 03:00).
- It does not start while a backup, an export or an import runs, or when the last minute already
  shows API answers or board saves over 1 s, or the CPU over 80 %. It does not start either
  without a recent heartbeat of the web and collaboration roles: the guard below would be blind
  (`no_metrics`). A scheduled run checks again when its time comes.
- While it runs the page shows a progress bar, the live numbers and **Stop**.
- **The guard** stops it when the people using the instance feel it: two readings in a row (5 s
  apart) with board saves p95 over 2 s, the API answers of everyone but the test over 2 s at p95
  or more than 5 % server errors, or the test's own edit round trip over 3 s. A reading that is
  missing (no heartbeat, or the monitor cannot be read) counts as past the limits. The guard
  reads from the start, also while the test boards are being created.
- A backup (also the nightly one or the one before an upgrade), an export or an import that
  starts during the run stops it at the next reading: the load test gives way, the backup does
  not wait.
- The report has the fields and limits of the CLI report; the last 10 runs are kept.
- It signs in with an account it creates in the database (no open registration needed) and a
  personal token, and records that account and its `Load test …` project on the run. They are
  deleted at the end, also after a stop, with any other project that account created (by its id,
  never by name). While it exists the account is not in Settings → Members, its count, or the
  people you can share with. After a crash or a restart the worker finds the run
  without a heartbeat within a minute and deletes them at its start, or within 5 minutes.
- Starts, stops and results are in the audit log (`loadtest.started`, `loadtest.stopped`,
  `loadtest.finished`).

The worker reaches the instance on its loopback with `all` (`http://127.0.0.1:PORT`), and through
`PUBLIC_URL` in split mode, where the proxy must route `/collab` as for browsers. The clients run
in the worker, so they take some of the machine's CPU: on a small server the numbers read lower
than from a separate machine.

With `all` (one process) the load clients also share the **event loop of the live server**:
every edit the test sends and every update it receives is handled in the same thread that answers
people. The numbers are a little pessimistic and people feel the load sooner, and the card says
so. `large` (50 editors, 1000 boards) is therefore refused there (`shared_process`): run it with a
separate `worker` role, or with the CLI from another machine.

## Running it

From a checkout of this repository (Node and pnpm as in [CONTRIBUTING](../../CONTRIBUTING.md)),
on a machine that is not the server, so the clients do not take its CPU:

```sh
pnpm install
METRICS_TOKEN=<the token of the instance> \
pnpm loadtest --preset medium --url https://inkadra-test.example.com --yes-i-know
```

- `--yes-i-know` (or `INKADRA_LOADTEST_CONFIRM=yes`) is required: without it the test explains
  what it would do and stops.
- The test signs up its own account, so the instance needs `REGISTRATION=open` while it runs.
  On an empty instance that account would become the administrator, and the last administrator
  cannot be deleted: sign up a first account yourself. To use an existing account instead, set
  `INKADRA_LOADTEST_EMAIL` and `INKADRA_LOADTEST_PASSWORD`; the test then deletes only its
  project, never the account.
- With `METRICS_TOKEN` (the instance's, see [Monitoring](configuration.md#monitoring)) the
  report adds the server's side: memory, board saves and database connections. Without it, it
  measures only what the clients see.
- In split mode, point `--collab-url` at the collaboration role when the proxy does not route
  `/collab` on the same address (`--collab-url http://localhost:3001` with
  `deploy/compose.split.yaml` and no proxy).
- `--duration <seconds>` changes the duration; `--out <name>` also writes `<name>.txt` and
  `<name>.json`.

The command exits with 0 when every limit holds, 1 when one was exceeded, 2 when it could not
start.

## Reading the report

```text
Inkadra load test · preset small · http://127.0.0.1:3911
5 editors, 2 readers, 50 boards, 60 s

Edits                 301 (13 board switches, 6 uploads, 0 failed)
Edit round trip       p50 0.8 ms · p95 2.1 ms · p99 3.4 ms (288 samples)   limit p95 500 ms, p99 1500 ms
Delivery to readers   p50 1.4 ms · p95 2.8 ms · p99 18.2 ms (163 samples)   limit p95 1000 ms
Errors                0   limit 0
Reconnects            0   limit 5
Board saves           p95 32.8 ms · slowest 34.1 ms   limit p95 1000 ms
Pool wait (saves)     slowest 24.6 ms   limit 1000 ms
Database connections  peak 14
Memory (board roles)  218 MiB before → peak 238 MiB   limit 1024 MiB
Board documents       4.8 KiB per open board (Yjs, encoded)   limit 256 KiB
Per open board        5 MiB over 5 boards   (info) memory growth of a process shared with other roles; not a limit

PASSED
```

- **Edit round trip**: from an edit until the server confirmed it. This is the delay people feel
  before their change is safe; past a few hundred milliseconds, the collaboration role or its
  host is saturated.
- **Delivery to readers**: from an edit until someone else on the same board received it.
- **Board saves**: Inkadra saves an open board to the database 2 to 10 seconds after a change.
  Slow saves point at the database (disk, `shared_buffers`, other load).
- **Pool wait**: the longest a save waited for a free database connection. When it grows, raise
  `DATABASE_COLLAB_POOL_MAX` (`all`) or `DATABASE_POOL_MAX` (`collab`), within the
  database's `max_connections`.
- **Memory**: resident memory of the processes holding boards before the test and at its peak.
- **Board documents**: the mean size of the open boards' Yjs documents, encoded, as the
  collaboration role measures them at each heartbeat; the largest over the run. This is what a
  board itself weighs, and it is the limit on board size. In memory a document takes a few times
  its encoded size.
- **Per open board**: the memory growth divided by the boards open at the peak, sockets, presence
  and garbage included. It is a limit only when the boards have a `collab` process of their own
  and at least 20 were open at the peak. Otherwise the report marks it `(info)` and the settings
  show it greyed out: in an `all` process the growth also holds the web and worker roles, and for
  a run from the settings the load clients themselves; with few boards open, uploads, socket
  buffers and the garbage collector move memory by more than the boards weigh.
- **Errors** lists the first ten. **Reconnects** counts connections the server or network
  dropped: a few happen; many mean a proxy timeout or a restart.

The server's numbers come from the metrics every role sends with its heartbeat, every 5 s:
`inkadra_process_resident_memory_bytes`, `inkadra_collab_open_boards`,
`inkadra_collab_open_board_bytes`, `inkadra_board_store_seconds`, `inkadra_board_store_pool_wait_seconds` and `inkadra_board_stores`.
Prometheus can watch them on a production instance too.

## Measured

The nightly [load test workflow](../../.github/workflows/loadtest.yml) runs `medium`, then
`dense`, against the image of `main` on a GitHub runner (4 cores, 16 GB), with the bundled
Postgres and Valkey, in `all` mode and in split mode, and keeps the reports as artifacts. A red
night opens an issue. It also runs on pull requests that change the load test.

| Run                           | Edit round trip p50 / p95 / p99 | Board save p95 | Pool wait | Memory before → peak | Per open board |
| ----------------------------- | ------------------------------- | -------------- | --------- | -------------------- | -------------- |
| `medium`, `all`, CI           | 0.7 / 1.1 / 1.4 ms              | 17 ms          | 17 ms     | 253 → 308 MiB        | 3.1 MiB        |
| `medium`, split, CI†          | 0.8 / 1.2 / 1.5 ms              | 18 ms          | 19 ms     | 190 → 240 MiB        | 2.6 MiB        |
| `small`, `all`, workstation\* | 0.7 / 1 / 1.4 ms                | 26 ms          | 18 ms     | 245 → 264 MiB        | 3.7 MiB        |

First runs, 14 November 2026. In both CI runs: 20 editors made about 3600 edits, 65 uploads and
130 board switches without an error or a reconnect; peak database connections 14 (`all`) and 23
(split). † Memory of the `collab` role only. \* Windows 11, server run from source.

Since #911 the `all` runs show **Per open board** as information only, and **Board documents**
decides: a `small` run in `all` mode on the workstation measured 4.8 KiB per open board
(15 November 2026), well under the 256 KiB limit, which is there to catch a document that keeps
growing, not boards with more content.

### Dense

| Run                          | Edit p50 / p95 / p99 | Delivery p95 / p99 | Board save p95 | Memory before → peak | Event loop p99, steady / burst | Burst: synced · fresh client agreed · stored |
| ---------------------------- | -------------------- | ------------------ | -------------- | -------------------- | ------------------------------ | -------------------------------------------- |
| `dense`, `all`, CI           | 1.3 / 11 / 345 ms    | 26 / 523 ms        | 303 ms         | 272 → 818 MiB        | 370 / 2611 ms                  | 7.0 · 1.0 · 1.8 s                            |
| `dense`, `all`, CI           | 1.1 / 11 / 243 ms    | 25 / 247 ms        | 1878 ms        | 279 → 849 MiB        | 396 / 2764 ms                  | 6.8 · 1.0 · 1.7 s                            |
| `dense`, `all`, CI           | 1.8 / 34 / 403 ms    | 36 / 356 ms        | 505 ms         | 275 → 831 MiB        | 808 / 3240 ms                  | 9.4 · 1.6 · 1.9 s                            |
| `dense`, split, CI†          | 1.5 / 13 / 296 ms    | 23 / 421 ms        | 388 ms         | 222 → 487 MiB        | (web) 15 / 12 ms               | 7.6 · 1.1 · 1.9 s                            |
| `dense`, split, CI†          | 1.5 / 11 / 555 ms    | 19 / 581 ms        | 1016 ms        | 222 → 514 MiB        | (web) 13 / 12 ms               | 7.7 · 1.1 · 1.9 s                            |
| `dense`, split, CI†          | 1.5 / 24 / 325 ms    | 70 / 756 ms        | 426 ms         | 223 → 485 MiB        | (web) 13 / 12 ms               | 9.2 · 0.9 · 2.0 s                            |
| `dense`, `all`, dev machine‡ | 2.3 / 241 / 721 ms   | 340 / 765 ms       | 441 ms         | 294 → 833 MiB        | 443 / 3890 ms                  | 9.4 · 1.3 · 1.9 s                            |

Runs of 22 November 2026; the CI runs last 180 s, the dev machine's 60 s. In every run: no
error, no reconnect, no edit left unacknowledged, every edit timed (about 2600 on CI, 500 of them
strokes, with about 34,000 cursor moves), all clients converged and the offline changes stored
and reopened intact. Board documents 7.4 MiB. † Memory and saves of the `collab` role. ‡ A
12-thread Linux machine shared with other work, server run from source, clients on the same
machine. Runs of an earlier version of the scenario, before the markers were added offline, synced
the 18 clients in 0.6 to 0.8 s on CI; whether the board was reloaded then cannot be told.

What the numbers say, and no more:

- **Steady run.** The edits stay fast for most people (p95 11 to 34 ms on CI), but the p99 of the
  edit round trip and of the delivery is 240 to 760 ms on CI, against about 1.5 ms with `medium`.
  In `all` the event loop of the process holding the board reaches 370 to 810 ms at p99 in its
  worst 5 s window, with the load clients on the same runner. The synchronous start of each save
  of this board (validating every card and encoding the whole document) measured about 130 ms on
  the dev machine; what else takes that process's time is not pinned down.
- **Burst.** With every client sending a new card at once, it takes 7 to 9.4 s on CI (9.4 to 10.9 s
  on the dev machine) until all 18 are synced again, and the event loop of the `all` process
  stalls up to 3.2 s at p99 (3.9 s on the dev machine). On the dev machine, with a temporary log in
  the server: the board was read back from the database before the reconnect; 11 of the 18
  clients were synced within 0.75 s and the others one after another up to 9.6 s; with only moves
  offline, no new cards, all 18 were synced in 0.85 s; admitting the updates (decision 0130) and
  the change hook each took under 20 ms but for the first size measurement after the load (120
  ms). Where the rest of the time goes is not pinned down.
- Once everyone left, the stored board had every offline change within 2 s.
