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

## Projects, crew members and shooting days

The same mechanism, table, retention and error codes now also cover `POST /projects`
(scope `projects`), `POST /projects/{id}/crew` (`crew:<projectId>`) and
`POST /boards/{id}/schedule` (`shooting-days:<boardId>`). They are advertised separately, as
`idempotent-project-creations`, so the meaning of `idempotent-creations` (boards and
comments) never changes and a client can tell which servers honour which set. A retry reads
the project, crew member or shooting day as it is now, or answers 404 once it is gone (a crew
member merged into another counts as gone). Validation that looks at current state (a linked
account or card of a crew member) runs on every attempt, so a retry can answer 400 where the
original succeeded; the client drops the creation either way.

Left out: the bulk crew paste (it skips names already present, so a replay creates nothing
new), share links (the response carries a secret shown once), invitations (they send email and
have their own resend), named versions and clips (outcome-unknown protocol, files and the
collaboration server, not a plain row), uploads (tus has its own resumption and
`clientAssetId`), `POST /schedule/edit` (a batch of edits with client ids), project groups,
exports, backups and tokens.

## Consequences

Old clients behave as before. Requests after expiry may create again. A retry after a
deletion gets 404, so a client drops the queued creation rather than recreating it. No bulk
endpoint, client-chosen board or comment ids, dependencies or background queue is introduced.
