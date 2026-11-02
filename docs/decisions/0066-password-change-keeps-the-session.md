# 0066 · A password change keeps the session that made it

Accepted, 2026-11. Refines [0028](0028-authentication-hardening.md) and
[0018](0018-cookie-only-auth-responses.md).

**Context.** `POST /api/auth/change-password` with `revokeOtherSessions` makes Better Auth delete
every session of the person and issue a new one in a new cookie. The collaboration server ties
an open board to the id of the session it signed in with and closes it (4401) when that session
is gone, so the tab that changed the password lost its board ("Sessione terminata") although
`/me` still answered 200. The collaboration server can run apart from the web server, so it
cannot be told about a replaced session.

**Decision.** A plugin in the auth setup turns `revokeOtherSessions` off for Better Auth and,
once the password has changed, deletes the person's other sessions itself. The session that made
the change, its cookie and its open boards stay as they are; no new cookie is issued. Personal
tokens are revoked as before (0028).

**Consequences.** "Le altre sessioni sono state chiuse" is true and the current tab keeps
editing. The session id is no longer renewed by a password change; it still ends at sign-out,
expiry, a reset (which revokes all sessions) or deactivation. The other sessions are deleted in a
second statement, right after the password update, not in the same transaction.
