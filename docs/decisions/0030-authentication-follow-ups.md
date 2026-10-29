# 0030 · Authentication follow-ups without contract changes

Accepted, 2026-10. Extends [0028](0028-authentication-hardening.md) and the share-link and
invitation rules of [0013](0013-review-and-sharing.md) and [0011](0011-collaboration-and-access.md).

**Account deletion.** `DELETE /me` checks the password through an internal Better Auth call,
which skips the HTTP hooks of 0028, so it had no attempt limit. It now takes the same budgets as
a password change: three attempts per 10 seconds per source network, plus the account's
failure budget shared with sign-in (50 an hour), which only a correct password refunds. Above
them the answer is 429 with `retry-after`; when the limit storage is unreachable it is 500,
because the API has no 503 code.

**Share-link passwords.** New and changed passwords need at least 10 characters, checked by the
server and the share dialog. The `CreateShareLink` and `UpdateShareLink` schemas still say 6:
raising their `minLength` changes the OpenAPI document and waits for a contract change. Links
whose password is shorter keep working until the password is changed. Wrong passwords are
limited per link and address and per link (0013), in memory and per process, with a fixed
15-minute window. A lockout that grows with repeated failures and is shared across processes
is not implemented yet.

**Instance invitation links.** An instance link creates an account for whoever opens it. Without
an explicit `expiresInDays` it now works once and for two days (`CreateInvitation` keeps its
7-day default, which still applies to project and board links); a request that sets
`expiresInDays` gets that expiry, still for one use. The use is counted by a conditional
`UPDATE … WHERE uses < max_uses` when the account is about to be created, not after, so
parallel sign-ups with the same link can never exceed `maxUses`. If creating the account
fails after that, the use stays counted.

**Browser policy.** The web app turns off Zod's code generation (`z.config({ jitless: true })`)
before any schema exists: Zod probes `new Function` the first time it builds an object schema,
and under `script-src 'self'` that probe is a CSP violation on every load, even though it is
caught. Parsing without generated code is slower for large objects; the web app parses small
API answers, so the difference does not show.
