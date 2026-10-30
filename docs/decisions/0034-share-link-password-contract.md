# 0034 · Share-link password contract

Accepted, 2026-10. Supersedes the deferred contract change in
[0030](0030-authentication-follow-ups.md).

`CreateShareLink` and `UpdateShareLink` now require 10–128 characters when setting a
password. The generated OpenAPI declares the same minimum. Both server routes parse
these shared schemas before storing a password, so their separate minimum-length check
is redundant and removed. Omission still preserves a password on update; null removes it.

`CreateGuestSession` retains its existing password input (maximum 128, no minimum).
Existing links with six-character passwords can still be unlocked, until their password
is changed. This contract change aligns clients with the server policy already enforced
by 0030; it does not invalidate stored passwords or require a database migration.
