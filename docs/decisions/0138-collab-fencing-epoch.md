# 0138 — A fencing epoch for the collab lease

Status: accepted (decided by the maintainer on 2026-11-23). Follows the single-process lease of
[#790](https://github.com/inkadra/inkadra/issues/790) and
[#819](https://github.com/inkadra/inkadra/issues/819).

## Context

Collab keeps each open board in memory and stores it whole in `board_doc.state`. Only one collab
process may run per instance, which a lease in Valkey enforces (`apps/server/src/lease.ts`). A
process that cannot reach Valkey, or that was paused, does not know that its lease ran out: for
up to a lease's life (30 s) it keeps serving its boards while a newer process has taken the
lease and serves the same boards. Both write the whole document, so whatever one of them stores
last drops the edits the other had stored.

## Decision

Every collab process takes an **epoch** at start, after its lease and before it writes or opens
any board: one row in the table `collab_epoch`, incremented with an upsert that returns the new
value (`takeCollabEpoch`), under the advisory lock `collab-epoch` held exclusively. Every board
write of collab begins its transaction with that lock held shared, then reads the epoch, and goes
on only when the recorded epoch is the process's own (`fenceCollabWrite`): the debounced store,
the replay of boards kept on disk, the search index and the board's schema version written after
a store, a named version, and a restore's backup version and its `board_restore` record.

- **Atomic in the database.** The shared lock is held until the write commits, and taking an
  epoch waits for every write in flight. Once the newer process holds its epoch, no write of an
  older one can commit: there is no window between a check and a write.
- **An advisory lock, not the row's.** A start waiting for a heavyweight lock is queued in front
  of the writes that come after it. With `FOR SHARE` on the row, later writes join the row's
  lockers and keep the update waiting, so a busy old process would starve the new one's start.
- **Fails closed.** A missing row or an epoch older than the process's own (a database restored
  under a running process) refuses the write too.
- **Bounded waits.** A fenced transaction holds the row at most 15 s per statement and per idle
  moment (`statement_timeout`, `idle_in_transaction_session_timeout`), so a process paused in the
  middle of a write loses its session. A start waits for the lock 20 s at a time, whatever the
  pool's `lock_timeout` (and never cut by its `statement_timeout`), logging that it waits for the
  previous process's writes, for at most five minutes. The lock comes first of all locks (level 0
  in `locks.ts`). Until the epoch is taken and the boards kept on disk are replayed, the process
  answers its health checks as starting.
- **Only while holding the lease.** The lease is confirmed (renewed) before every try and just
  after the epoch is taken, and a lease lost while starting ends the start (also the wait for the
  migrations): a process cut off during a long start must not fence out the one that took over.
  A takeover between the confirmation and the epoch (a pause of one statement) stops both
  processes, whose writes are refused, until one starts again; nothing is overwritten.
- **In PostgreSQL, not Valkey.** Valkey may run without persistence: a counter there would start
  from zero again after a restart and refuse every write. The epoch lives with the documents it
  guards. It is left out of backups; a restored instance takes epoch 1 at its first start.
- **A refused write stops the process.** It is logged once (`another collab process took over
  the boards`) and the process shuts down as on a lost lease: in split mode the collab server
  closes first (boards stored or kept on disk, sockets closed), then the board queue's worker,
  whose close is bounded, as a Valkey cut off by the same partition would keep it waiting. Until then it refuses new
  WebSockets at the upgrade (clients retry and reach, through the proxy, the newer process), its
  stores no longer reach the database, and clips, named versions and restores say they did not
  happen (`expired`). A restore refused only at its record, after it changed the board in memory,
  answers that its outcome is unknown. Its people's clients hold their edits and send what the
  newer process lacks when they reconnect.
- **What it held in memory.** Boards the old process still holds are kept on disk at shutdown,
  as for a database that does not answer ([#795](https://github.com/inkadra/inkadra/issues/795)).
  The process serving the boards merges the files of its own `unsaved-boards` folder every
  minute into the live board (Yjs makes the merge harmless), so a container started again on the
  same volume merges them within a minute, not at its next restart weeks later. A file is taken
  by renaming it (`.draining`) and removed only once the stored board holds it (its whole encoded
  state, what Yjs holds back included, is unchanged by the file), or the board is gone; a start
  replays the `.draining` files a stopped run left. A file that fails to merge is tried again
  with backoff (at most an hour apart); one that is not an update is renamed `.unreadable` and
  left for an operator, by the merge and by the replay alike. In the demo, a file that would take
  its board past the caps is dropped, as the demo never stores such a board. Files on another data volume are merged only when a
  collab process starts on that volume: the log line of the shutdown names each file. Merging
  late can apply deletions made then.
- **Writes that do not overwrite are not fenced**: who wrote (decision 0120), task notifications
  and automatic versions only add rows, and run after a store that the fence let through. The
  search index backfill rebuilds from the stored document, not from memory.
- **One process.** Each start takes a new epoch, also without Valkey: a second collab process
  started without `REDIS_URL` now stops the older one at its first store, instead of both
  writing over each other.

## Consequences

- Single-process instances behave as before, apart from one row updated at each start and one
  shared advisory lock per board write.
- A collab process of a release before this one does not fence its writes: an upgrade stops the
  old process before starting the new one, as the self-hosting guide already asks.
- A start that fails now releases its leases, instead of leaving them for the next start to wait
  out; a start killed by a signal still leaves them to expire.
