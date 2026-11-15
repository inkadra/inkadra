# Capacity

How many people can work on one Inkadra instance at the same time depends on the machine, the
database and the boards. The load test measures it for your setup: it connects editors and
readers to an instance, the way the web app does, and reports how long edits take to come back,
how long boards take to save and how much memory each open board costs.

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
upload), on more reconnects than editors, on more than 8 MiB per open board, and on a slow wait
for a database connection (1, 2 and 5 s). The limits are generous on purpose: they catch a
regression of several times on a shared CI machine, not a few percent. They live in
[`apps/server/src/loadtest/report.ts`](../../apps/server/src/loadtest/report.ts).

What the clients do: the test seeds the boards through the API, with 20 notes each. Each editor
opens a random board, adds a note, then moves it about once a second while moving its cursor,
uploads a small picture about once a minute, and moves to another board every 20 to 40 seconds.
Each reader follows an editor from board to board without writing.

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
Inkadra load test · preset small · http://localhost:3902
5 editors, 2 readers, 50 boards, 60 s

Edits                 299 (12 board switches, 6 uploads, 0 failed)
Edit round trip       p50 0.7 ms · p95 1 ms · p99 1.4 ms (287 samples)   limit p95 500 ms, p99 1500 ms
Delivery to readers   p50 1.2 ms · p95 1.8 ms · p99 2.3 ms (116 samples)   limit p95 1000 ms
Errors                0   limit 0
Reconnects            0   limit 5
Board saves           p95 25.5 ms · slowest 27.1 ms   limit p95 1000 ms
Pool wait (saves)     slowest 17.7 ms   limit 1000 ms
Database connections  peak 14
Memory (board roles)  245 MiB before → peak 264 MiB   limit 1024 MiB
Per open board        3.7 MiB over 5 boards   limit 8 MiB

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
  **Per open board** is the growth divided by the boards open at that peak, sockets and presence
  included; with few boards open it is rough, since the garbage collector moves memory by more
  than a board weighs.
- **Errors** lists the first ten. **Reconnects** counts connections the server or network
  dropped: a few happen; many mean a proxy timeout or a restart.

The server's numbers come from the metrics every role sends with its heartbeat, every 5 s:
`inkadra_process_resident_memory_bytes`, `inkadra_collab_open_boards`,
`inkadra_board_store_seconds`, `inkadra_board_store_pool_wait_seconds` and `inkadra_board_stores`.
Prometheus can watch them on a production instance too.

## Measured

The nightly [load test workflow](../../.github/workflows/loadtest.yml) runs `medium` against the
image of `main` on a GitHub runner (4 cores, 16 GB), with the bundled Postgres and Valkey, in
`all` mode and in split mode, and keeps both reports as artifacts. A red night opens an issue.

| Run                           | Edit round trip p50 / p95 / p99 | Board save p95 | Pool wait | Memory before → peak | Per open board |
| ----------------------------- | ------------------------------- | -------------- | --------- | -------------------- | -------------- |
| `medium`, `all`, CI           | 0.7 / 1.1 / 1.4 ms              | 17 ms          | 17 ms     | 253 → 308 MiB        | 3.1 MiB        |
| `medium`, split, CI†          | 0.8 / 1.2 / 1.5 ms              | 18 ms          | 19 ms     | 190 → 240 MiB        | 2.6 MiB        |
| `small`, `all`, workstation\* | 0.7 / 1 / 1.4 ms                | 26 ms          | 18 ms     | 245 → 264 MiB        | 3.7 MiB        |

First runs, 14 November 2026. In both CI runs: 20 editors made about 3600 edits, 65 uploads and
130 board switches without an error or a reconnect; peak database connections 14 (`all`) and 23
(split). † Memory of the `collab` role only. \* Windows 11, server run from source.
