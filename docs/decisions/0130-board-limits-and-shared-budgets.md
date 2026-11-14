# 0130 — Board limits and shared product budgets

## Context

Collaboration state needs a finite per-board allowance on ordinary instances as well as the
demo. Product request budgets must follow a person across web replicas, as auth budgets do.

## Decision

Normal boards default to 64 MiB of encoded Yjs state and 20,000 elements, configurable with
`BOARD_MAX_STATE_BYTES` (bytes or a size such as `64MB`) and `BOARD_MAX_ELEMENTS`. Refuse
updates that exceed a cap before applying them. Always admit deletions of items the board holds, including on boards already oversized at
upgrade; a deletion naming items the board lacks is refused, as Yjs would store it unmeasured.
Updates Yjs holds back until the items they follow arrive count towards both caps.
Admission reads the update without applying it to a copy of the board: the cards it may add
from the keys it sets, the bytes from the board's measured size plus the update's. An update
that would fit only thanks to what it also deletes is refused; its deletions then pass alone.
The measured size is reused until something else is applied, so refused additions on a full
board cost no new measurement. Cards the server adds (clips, the share sheet) keep to the same
caps and are refused with 409 on a board at a cap.
Restoring an older version and importing a project are not limited on ordinary instances:
nothing stored becomes unusable, even when it is over today's caps. The demo keeps its own
rule for versions (decision 0084).
Do not truncate stored data or freeze editing roles. The demo keeps its existing full freeze.
Keep the 16 MiB normal WebSocket message allowance and existing validation and persistence.

Reuse `writeRefused: frozen` for the explanation. The web client reopens confirmed state after
a refusal because a rejected Yjs struct leaves a clock gap for subsequent edits from that
client. The notice explains that additions were not saved and that deletions remain available.
Clients of the collaboration protocol should follow the same recovery path. No schema changes.

With Valkey, product budgets use atomic sliding windows in the existing instance-scoped,
hashed auth storage. Each limiter has a stable distinct scope. Password checks reserve a slot
before checking and refund successful checks; other callers retain their counts and responses.
Without Valkey, retain the bounded in-memory windows. When a configured Valkey does not answer,
each process falls back to those same in-memory windows, password checks included: the limits
of an instance without Valkey, rather than letting every request through or refusing every
guest. Startup waits a few seconds for Valkey, then starts with that fallback. No new dependency.

## Consequences

Older oversized boards load and deletions are saved. Yjs history metadata can keep encoded
state over its byte cap after content is deleted; operators may raise that cap. Rejected local
additions are discarded when reopening confirmed state, and the notice explicitly says so; the
deletions made in the discarded copy are made again once the reopened one has synced.
Limits cover collaboration updates; storage accounting and version/export budgets are separate.
