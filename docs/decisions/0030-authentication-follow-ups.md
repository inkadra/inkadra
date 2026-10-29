# 0030 · Authentication follow-ups without contract changes

Accepted, 2026-10. Extends [0028](0028-authentication-hardening.md) and the share-link and
invitation rules of [0013](0013-review-and-sharing.md) and [0011](0011-collaboration-and-access.md).

**Account deletion.** `DELETE /me` checks the password through an internal Better Auth call,
which skips the HTTP hooks of 0028, so it had no attempt limit. It now has its own budgets:
three attempts per 10 seconds per source network, as for a password change, and 10 failures an
hour per user, which only a correct password refunds. It does not share sign-in's failure
budget per address: anyone who knows the address can spend that one with failed sign-ins, and
the signed-in person would then be refused the deletion. Above the budgets the answer is 429
with `retry-after`, and a refused attempt counts against neither. Only Better Auth's
`INVALID_PASSWORD` answer is a wrong password (403, counted); any other error while checking is
500 and is not counted. When the limit storage is unreachable it is also 500, because the API
has no 503 code. People without a password (Google or OIDC only) confirm by having signed in
within the last 15 minutes, as before.

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
fails after that, the use stays counted: the reservation runs in Better Auth's `user.create`
hook, outside its transaction, and no hook runs when the creation fails, so there is no
reliable place to give it back. This applies to email invitations (one use) and single-use
instance links alike; the administrator or the inviter sends a new invitation. The sign-in
guide for administrators says so.

**Browser policy.** The web app turns off Zod's code generation (`z.config({ jitless: true })`)
before any schema exists: Zod probes `new Function` the first time it builds an object schema,
and under an enforced `script-src 'self'` that probe is a CSP violation on every load, even
though it is caught. With the default report-only policy `new Function` succeeds, so without
this setting Zod would compile its parsers; with it, Zod always takes the interpreted path,
including `Element.safeParse` for every element of a board. That path is slower for large
objects. The Canvas performance job in CI passed with the change, so the difference does not
show on the boards it measures.
