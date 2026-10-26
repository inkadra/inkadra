# 0022 · Shooting schedules in Postgres, storyboard references by id

Accepted, 2026-10.

**Context.** Shooting days are project production data, rather than drawings or shot screen
lengths. They need calendar queries and eventually call sheets across boards. Storyboard
frames remain the source of truth for shot content (0012). Board grants can restrict access
within a project (0011), so a project-wide endpoint must not expose a restricted board's plan.

**Decision.**
- Postgres stores `shooting_day`, owned by a project and anchored to a board. The first slice
  lists days for the current board only and checks its effective role: viewer reads, editor
  writes. No guest endpoint exposes internal production notes or cast. Guests see an empty,
  read-only schedule. A future project overview must filter by effective board access.
- Each day has a local calendar date, call time, optional planned wrap, location and notes.
  Clock times have no timezone conversion: they describe the shooting location's local day.
  Its ordered blocks are a bounded JSONB array, validated through shared Zod/OpenAPI contracts.
  Blocks have stable UUIDs, setup/shot/break/move/note type, title, optional start, estimated
  minutes, optional frame id and plain cast/department lists. Their array position is order.
  Keeping one bounded aggregate makes reordering atomic; there is no second shot content table.
- A null start follows the preceding block, starting from call time. Explicit clock times
  before call are interpreted on the next day; calculated times may cross midnight. Wrap is
  a planning target, not a truncation of blocks. Estimates are shooting minutes, independent
  of the frame's screen duration. Concurrent cast overlaps are client warnings, not errors.
- Updates and deletion require the last read day revision; one atomic compare-and-increment
  refuses a stale edit with 409. The client preserves its draft and offers an explicit reload.
  This slice is online REST editing; offline merge and live push are deferred. Different days
  can be edited independently. No board document writes or schema migration are needed (0014).
- Frame ids are references scoped to the day's board, resolved from its live storyboard. A
  removed frame leaves its scheduling block intact, with a missing-shot label; deleting a
  block never deletes the shot. The UI accepts drops only from that board's current queue.
  References are not foreign keys into the eventually consistent search index.

**Consequences.** One generated SQL migration adds the day aggregate. Project and board
removal cascade to its days. Block edits replace the aggregate, so simultaneous edits of a
single day need reconciliation rather than silently dropping another person's changes.
The current queue is board-local; cross-board planning and call sheets can build on these
project-owned rows later without changing the ownership of scheduling data.
