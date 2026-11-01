# 0061 — Private calendar subscriptions

## Context

Calendar clients need an unauthenticated read-only URL, independent of browser sessions.
The approved #314 mockup places it in Notifications; on phones it also offers webcal.

## Decision

Use one revocable credential per user. Store only its SHA-256 digest and a public random
generation identifier. Derive the credential with domain-separated HMAC-SHA256 using the
installation AUTH_SECRET, user id and generation. This lets the owner retrieve the same URL
without storing plaintext or reversible encrypted credentials. Compare digests in constant time.
Rotating the installation secret requires users to regenerate their feeds.

Every request rechecks active membership and account status before reading data or answering
304. Feed requests are limited per network and per user using the existing bounded in-process
limiter. Multi-process deployments multiply that budget. Administrators may disable feeds.
Request logging redacts the bearer path; reverse proxies must likewise avoid logging it.

The feed shows what My Tasks shows to a member: board access comes from `boardRoles`, and the
guest-only filters (guest-hidden to-dos, cards missing from a parent board) do not apply.
It is bounded: events from 90 days ago to one year ahead, at most 2000, shooting days read in
one query and each stored document decoded once. A damaged document is skipped and logged
(never the bearer) instead of failing the feed. The ETag is a fingerprint of the rows' update
timestamps, the window and the credential, so a conditional request answers 304 before any
document is decoded. The calendar declares an hourly refresh (`REFRESH-INTERVAL`,
`X-PUBLISHED-TTL`) and is named `Inkadra`, plus the instance name when it differs.

Emit RFC 5545 with stable UIDs, CRLF, escaped text and UTF-8 octet folding. Shooting times
are converted from the project's IANA time zone to UTC (default UTC for existing projects).
Due dates remain all-day dates. Internal notes are excluded. A wrap time equal to the call
time leaves the event without an end; an earlier wrap is an overnight shoot ending the next day.
Stored document snapshots have the same short persistence delay as My Tasks (#304).
ETags describe the full current representation, including removals; clients must revalidate.

## Consequences

Possession of a URL grants access to its events. The credential is derived from `AUTH_SECRET`,
so the owner's personal API token (which can call `GET /me/calendar-feed`) can also read the
feed URL; revoking the token does not revoke the feed, regenerating the link does. Revocation prevents future refreshes but
cannot remove events already downloaded by calendar clients. No document schema changes.
Project time zones are an additive API/database field; older clients continue to use UTC.
