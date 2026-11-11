# 0099 — Recognizable invalid tokens

Status: accepted. Follows [0096](0096-authenticated-client-compatibility.md).

## Context

An installed client cannot tell a revoked token, an expired one and a deactivated account
apart from any other authentication failure: revocation deletes the token row and its hash.
It needs to know whether to ask the person to sign in again or just to wait.

## Decision

Revocation still deletes the `personal_token` row, as before. In the same step the server
copies the token hash, its user and a reason (`token_revoked` for the owner's own revocation,
a password change or reset; `account_deactivated` for an administrator's deactivation) into a
separate `revoked_token` table, kept thirty days and purged by upload housekeeping.

A separate table rather than a `revoked_at` column on `personal_token`: no token query can
forget a filter, and an operator who rolls the server image back after this migration keeps
every revoked token revoked, because older code never sees the deleted rows.

A REST 401 for a bearer token adds `error.details.reason` (`InvalidToken` in
`packages/shared`) only when the exact token hash is recognised: in `revoked_token` within
thirty days, or a still stored token that expired (`token_expired`) or whose account is
deactivated. Unknown tokens, cookies and older revocations keep the generic 401, so the
reason is never an oracle for tokens the caller does not hold.

The collaboration socket is unchanged: token connections are still closed with
`4401 Unauthorized` (decision 0011) and the authentication failure carries no reason. A
client that needs the reason makes one authenticated REST request. The server advertises
the `token-invalid-reasons` capability (0096).

## Consequences

Only hashes are stored, never token plaintext. Account deletion cascades the hashes at once.
Reactivating an account never restores its revoked tokens. Expired tokens stay listed in
Settings as before. No remote wipe instruction or client data policy is added.
