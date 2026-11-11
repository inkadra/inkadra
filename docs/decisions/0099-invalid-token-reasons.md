# 0099 — Recognizable invalid tokens

## Context

Clients cannot distinguish a revoked token, expiry and account deactivation from the
existing generic authentication failure. Deleting revoked hashes loses this information.

## Decision

Keep the hashed personal token with revocation timestamp and reason for thirty days.
Authentication always excludes revoked rows; account lists and token caps exclude them too.
Password changes, resets and account deactivation use the same retained revocation state.
Expired tokens are recognizable for thirty days after expiry. Upload housekeeping purges
these records. Only an exact token hash match receives error.details.reason in REST;
unknown tokens and cookies keep their existing errors. Collaboration authentication and
4401 closure reasons carry the same names when recognizable.

## Consequences

No token plaintext, remote deletion instruction, client data policy or wipe flag is added.
The row can be extended later without changing token hashing. Account deletion still
cascades hashes immediately. Reactivation never restores revoked token access.
