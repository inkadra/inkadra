# Gate 0.3 collaboration simulation

`pnpm --filter @inkadra/server test:collab-sim` runs the same test included in
`pnpm --filter @inkadra/server test`: 30 seconds of activity plus setup,
convergence, persistence and restart checks. It requires **both** DATABASE_URL
and REDIS_URL; without them the test is skipped. Use disposable services:
the fixture truncates users, projects and instance settings.

For a 30-minute soak on a machine with Postgres and Valkey:

```sh
DATABASE_URL=postgres://inkadra:inkadra@127.0.0.1:55483/inkadra \
REDIS_URL=redis://127.0.0.1:56483 \
COLLAB_SIM_DURATION_MS=1800000 COLLAB_SIM_SEED=305 \
pnpm --filter @inkadra/server test:collab-sim
```

On the workstation, set these variables in cmd.exe and invoke pnpm with
`npx.cmd -y pnpm@10.28.0`. Use a dedicated clone under `H:\T3 CODE\`,
`core.autocrlf=false`, and a unique Docker Compose project with ports bound to
127.0.0.1; remove its throwaway services and volumes with `docker compose down -v`
after the run. Never use a development or production database.

Ten distinct editor accounts authenticate using real session cookies over
`/collab`, with the web application's Hocuspocus provider and doc-schema.
Seeded workload choices run every 500 ms: notes, frames, moves, resizes, frame
fields, deletions, concurrent rich-text inserts and conflicting shared moves.
One editor edits offline for a quarter of the run; the others suffer random
connection drops. A separate viewer attempts an unauthorized write.

The test records every intended operation. Independent scalar writes are checked
against their last intended values, deleted elements must be absent, and all
concurrent text tokens must survive. Conflicting scalar writes use Yjs's normal
winner semantics: their expected state comes from an independent document that
merges only local simulation transactions, never received network updates.
All ten clients must match that document (encoded update after a fresh decode to compact garbage-collected struct boundaries,
raw state vector and
element JSON), validate, match a flushed database snapshot, and survive a fresh
web/collab server instance. Server error logs fail the test.

The final JSON reports operation count, seed, convergence, state bytes, process
peak RSS, recovery time, and maximum observed delivery lag. Lag samples check
source clocks at a reference editor every 500 ms; they include intentional offline
time, and are not a production latency benchmark. RSS includes the test clients
and independent oracle in the same process as the server. No fixed RSS threshold
is portable across platforms; recovery must finish within 20 seconds.
