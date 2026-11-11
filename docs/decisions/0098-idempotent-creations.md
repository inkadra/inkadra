# 0098 — Remember offline creation requests

Status: accepted. Follows [0096](0096-authenticated-client-compatibility.md).

## Context

A queued client can lose the response to a successful board or comment creation, retry,
and create a duplicate.

## Decision

Use an optional `Idempotency-Key` header on board and comment creation, scoped to user,
endpoint and parent (`boards:<projectId>`, `comments:<boardId>`). Like feedback request ids,
serialize attempts with a PostgreSQL advisory lock on the key hash and commit the resource
together with the remembered request. Reject a changed validated payload with the same key
(409). Retain keys for seven days and clean them with upload housekeeping.

Remember only the **id** of the created resource, not its response. A retry is answered like
a read of that resource as it is now (current title, role, edits, reactions), or 404 once it
is deleted or out of reach. A stored response would replay, for up to seven days, a board
that has since been trashed or a role that has since changed, and would keep other people's
display names after they delete their account.

Authentication, authorization and rate limits run on every attempt, retries included, and
before the key is looked up: the comment limit stays ahead of any query, as before. Replayed
comments do not notify again. The server advertises the `idempotent-creations` capability
(0096).

Rate-limit refusals carry `Retry-After`: the shared in-memory limiters give the remaining
window, the hourly invitation and share-link caps the time until their oldest entry leaves
the hour, the calendar feed its limiter window. Capacity refusals (busy workers, a full demo)
may omit it.

## Consequences

Old clients behave as before. Requests after expiry may create again. A retry after a
deletion gets 404, so a client drops the queued creation rather than recreating it. No bulk
endpoint, client-chosen board or comment ids, dependencies or background queue is introduced.
