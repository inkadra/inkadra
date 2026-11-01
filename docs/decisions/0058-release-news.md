# 0058 — Opt-in release news and SMTP delivery claims

## Context

Release news is optional per person, gated by SMTP and the administrator. Several containers
can start together, and Redis and PostgreSQL cannot share a commit. SMTP offers no idempotency
key: a connection loss after acceptance cannot distinguish delivery from failure.

## Decision

PostgreSQL is the outbox: a global transaction advisory lock compares strict SemVer versions,
snapshots active, opted-in accounts, and records the announcement. A deterministic
BullMQ job is enqueued after commit and recovered on subsequent starts. Only the running
version or older versions are recovered, so stable containers never announce newer pre-releases.
A pre-release instance can announce its own pre-release; build metadata is ignored.

Recipients are claimed durably before SMTP, with a global advisory lock spacing claims by one
second. Consent, activation and the administrator switch are rechecked at send
time. Retries resume unclaimed recipients; an ambiguous SMTP failure or crash after claiming
can lose one email, but cannot duplicate it. We choose at-most-once attempts rather than claim
exactly-once SMTP delivery. The first deployment announces the running version only to accounts
already opted in. Disabling delivery leaves pending recipients paused until a subsequent start.

## Consequences

No tracking resources or remote content. Bundled notes are escaped plain text, bounded to 4000
characters; missing notes use a localised generic introduction and the project release URL.
Notes may use `<version>.it.md`, `<version>.en.md`, or `<version>.md`. Deactivated
accounts never receive release news. Exactly-once delivery would need a provider supporting
idempotency keys; this implementation deliberately adds no provider integration.
