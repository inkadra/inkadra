# 0100 — An incremental board index

Status: accepted.

## Context

Decision 0094 left `BoardStore.index` rebuilding every sorted list after any edit.
Each container filtered the entire board, including during the initial read. A cell edit
or a stroke therefore paid for unrelated columns as well as the canvas.

## Decision

Keep the validated, synchronous snapshot and update only lists containing touched cards.
Content edits replace references in their existing positions without sorting. Membership
or ordering edits group the current cards once and sort only the affected containers,
using the existing canvas-core ordering helpers (including their id tie-break).
New containers also collect children that already referenced them. Unchanged cards and
unaffected lists keep their identity; previously published snapshots remain unchanged.
List equality first checks length and then compares items by identity or JSON, serializing
only replaced items rather than all unchanged strokes/rows after a single edit.

Opening uses the same grouping pass, removing the scan of the whole board per column.
Malformed key/id pairs retain the old full rebuild, as the helpers' snapshot view already
excludes these documents. No schema or validation rule changes.

The reference generator exposes a development-only subpath and a replica observer so a test
can compare the index against a full rebuild after the actual generator gestures and syncs.

## Consequences

- Content edits no longer sort; a move between containers sorts just those containers.
- Copying the snapshot map, reading the changed element and finding the last z in helpers
  still cost time. The benchmark reports these costs rather than an isolated index microbench.
- Opening still validates all elements. Inspection of 0094's read path found no duplicate
  validation of the large lists: they already bypass the second parse of the element.
  Lazy validation would change the complete synchronous snapshot contract, so it is not used.
- `BoardStore.hydrate(doc, { budgetMs: 8 })` opts into cooperative initialization and returns
  the store immediately. `hydrating` stays true until `whenHydrated` resolves. Until then the
  snapshot is empty; no partial element is published. Subscribers are notified once the
  complete validated snapshot is ready. The normal constructor remains synchronous.
- The element reader can yield between individual large-list items and fields; both paths
  use the same validation logic. A local or remote change during a pause discards the pending
  snapshot and restarts against the new document. Helpers fall back to validated document
  reads during hydration. Continuous editing can postpone completion; consumers should await
  readiness before rendering the board. Destroying the store cancels publication.
- The budget is cooperative, not preemption: one item, one field conversion, the final
  element parse and the final index cannot be interrupted. Larger individual fields would
  need additional split points if they dominate a future reference board.
- The benchmark includes total open and its longest observed blocking slice. The current
  synchronous path has one slice comprising applyUpdate and the first read, with no yield
  between them. The opt-in path yields before reading; `Y.applyUpdate` remains a monolithic
  blocking slice and is reported separately. A timer measures the longest event-loop gap
  during hydration, including scheduling and GC. Node without JIT is a proxy, not a device
  measurement. There is no document schema, server/API contract or web behavior change.
