# 0011 · Collaboration and access: roles per board, invitations, app tokens, presence

Accepted, 2026-10.

**Context.** Wave 2 makes Inkadra multi-user. A studio shares a whole project with its crew
but a single board with a costume designer or a client; people join from an email or a link
even when the instance is invite-only; the browser clipper and the mobile app need to sign
in without cookies; and people editing the same board need to see each other.

**Decision.**
- **Roles.** `owner` > `editor` > `commenter` > `viewer`, on the project (`project_member`)
  and on boards (`board_grant`). The effective role on a board is the one of the **nearest**
  grant for that person on the board or one of its ancestors, else the project role, else
  none. A grant can raise or lower the inherited role; the interface marks it as custom.
  People with grants but no membership see only the granted subtrees: their projects are not
  in `GET /projects`, `GET /shared-boards` lists the entry points, `GET /projects/{id}/boards`
  answers with the boards they can open and breadcrumbs stop at the first board they can open.
- **Who can share.** Editors and owners. You can give at most your own role and cannot change
  someone whose role is above yours. Changing or removing existing project members and
  anything about owners stays with owners; a project always keeps one owner.
- **What each role can do.** Viewers and commenters connect to board documents read-only, on
  the WebSocket as well as the API. Viewers do not download originals: `?download=1` is
  refused, and so are image originals once thumbnails exist (they see the 2048 px one); video,
  audio and PDF originals still stream, because there is nothing else to show. Files of a
  project are readable by anyone with a role on one of its boards (ids are random UUIDs).
- **Revocation.** The collab server checks the role again at most every 30 seconds while a
  connection is open: a lost role closes it, a lower one makes it read-only.
- **Invitations.** `invitation` rows target a project, a board or (administrators) the
  instance alone. `email` invitations are single use, `link` invitations work until they
  expire (1 to 90 days) or are revoked. Inviting the address of an existing account gives the
  role at once. The token is looked up by SHA-256 and kept sealed (AES-256-GCM, key derived
  from `AUTH_SECRET`) so managers can copy the link again. Opening a link sets a short-lived
  cookie (`claim`); a sign-up with any method while it is set is allowed in `invite` mode and
  accepts the invitation once the account exists.
- **Sign-in methods** (Better Auth plugins): email and password, Google
  (`GOOGLE_CLIENT_ID`/`SECRET`, optional `GOOGLE_ALLOWED_DOMAINS`), one generic OIDC provider
  (`OIDC_*`, discovery URL), sign-in links by email and TOTP two-factor with backup codes.
  Email needs `SMTP_URL`; without it sign-in links and invitation emails are off and
  invitations are shared as links. Accounts are linked by verified email for Google and, if
  `OIDC_TRUST_EMAIL=true`, for the OIDC provider. The Google button follows Google's branding
  rules (coloured "G").
- **Tokens.** `personal_token` keeps a SHA-256 of `ink_` + 32 random bytes (base64url). They
  authenticate REST calls (`Authorization: Bearer`) and the collab WebSocket (Hocuspocus
  `token`). Official apps get one through `/authorize`: an OAuth 2.0 authorization code with
  PKCE (S256 only) and fixed redirect URIs per client (`https://<id>.chromiumapp.org/…` for
  the clipper, `inkadra://…` for the mobile app), the code stored for 2 minutes in
  `verification`. Tokens cannot delete the account or create other tokens.
- **Account deletion.** `DELETE /me` asks for the password, or a sign-in in the last 15
  minutes for accounts without one. It is refused while the person is the only owner of a
  project shared with others; projects nobody else is in are deleted with their files.
- **Presence.** Yjs awareness, schema in `@inkadra/doc-schema` (`PresenceState`): clients
  publish cursor, selection and the element being edited; the server overwrites `user` and
  `readOnly` from the session on every update (`beforeHandleAwareness`), drops malformed
  states and does not let a connection remove someone else's presence.

**Consequences.** Grants make "who can see this" a tree walk, done in one recursive query per
check. Guest links without an account (wave 3) are a separate mechanism on top of this one.
A token is as powerful as a session except for the account-level actions above, so the
settings page lists them with their last use.
