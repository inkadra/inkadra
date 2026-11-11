# 0098 — Remember offline creation requests

## Context

A queued client can lose the response to a successful board or comment creation.

## Decision

Use an optional Idempotency-Key header, scoped to user and endpoint. Like feedback
request ids, serialize with a PostgreSQL advisory lock and remember successful results.
Commit the resource and response together. Retain responses for seven days, clean them
with upload housekeeping, and reject a changed validated payload with the same key.
Authentication and authorization still run on retries. Replayed comments do not notify again.
Expose the shared rate limiter's remaining window as Retry-After.

## Consequences

Old clients behave as before. Requests after expiry may create again. No bulk endpoint,
client-chosen board/comment ids, dependencies or background queue is introduced.
