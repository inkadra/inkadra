# 0130 — Board limits and shared product budgets

## Context

Collaboration state needs a finite per-board allowance on ordinary instances as well as the
demo. Product request budgets must follow a person across web replicas, as auth budgets do.

## Decision

Normal boards default to 64 MiB of encoded Yjs state and 20,000 elements, configurable with
`BOARD_MAX_STATE_BYTES` and `BOARD_MAX_ELEMENTS`. Refuse updates that exceed a cap before
applying them. Always admit pure deletions, including for boards already oversized at upgrade.
Do not truncate stored data or freeze editing roles. The demo keeps its existing full freeze.
Keep the 16 MiB normal WebSocket message allowance and existing validation and persistence.

Reuse `writeRefused: frozen` for the explanation. The web client reopens confirmed state after
a refusal because a rejected Yjs struct leaves a clock gap for subsequent edits from that
client. The notice explains that additions were not saved and that deletions remain available.
Clients of the collaboration protocol should follow the same recovery path. No schema changes.

With Valkey, product budgets use atomic sliding windows in the existing instance-scoped,
hashed auth storage. Each limiter has a stable distinct scope. Password checks reserve a slot
before checking and refund successful checks; other callers retain their counts and responses.
Without Valkey, retain the bounded in-memory windows. Match auth's outage policy: ordinary
product requests fail open for availability, password checks fail closed. Startup still waits
for configured Valkey. No new dependency.

## Consequences

Older oversized boards load and deletions are saved. Yjs history metadata can keep encoded
state over its byte cap after content is deleted; operators may raise that cap. Rejected local
additions are discarded when reopening confirmed state, and the notice explicitly says so.
Limits cover collaboration updates; storage accounting and version/export budgets are separate.
