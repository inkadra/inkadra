# 0096 — Authenticated client compatibility

## Context

Installed clients can talk to servers of different ages. Public endpoints intentionally
omit software identity (0032).

## Decision

Extend only the authenticated version endpoint with the API version, document schema
version, optional platform minimums and stable capability names. Unknown names are ignored.
Keep new response fields optional in the shared parser for older servers. Start with
boards, comments and resumable uploads; advertise additions only when implemented.
Record a bounded, validated Inkadra-Client header as a structured request log field only.

## Consequences

Existing clients continue reading version. No public fingerprinting fields, client
blocking, new configuration or minimum client policy are introduced.
