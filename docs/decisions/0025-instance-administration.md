# 0025 · Instance settings and member administration

Accepted, 2026-10-27.

Administrators need an instance directory independent of project access. API 0.7.0 adds
admin-only GET/PATCH `/instance/settings`, GET `/instance/members`, and PATCH
`/instance/members/{userId}`. Every authorization resolves the current database role;
member mutations recheck the administrator inside the transaction. An advisory transaction
lock serializes mutations and account deletion, preserving at least one active admin even
for concurrent demotions, deactivations and deletion.

Instance name and registration overrides use the existing `instance_setting` table,
falling back to environment defaults. Registration adds `closed`: nobody can create an
account, even with an invitation; existing users and guest links keep working. `invite`
continues to accept invitations and `open` allows public registration. Reads and all signup
methods consult persisted settings without restarting. Provider configuration stays read-only.
The name brands the web shell; installation-level auth/email labels still use INSTANCE_NAME.

Migration 0007 adds nullable `user.deactivated_at`. Deactivation preserves identity, content
and memberships, revokes sessions/tokens and prevents new sessions. HTTP and collaboration
also check status against races and stale credentials; reactivation does not restore revoked
tokens. Account deletion also refuses the last active admin. Session timestamps/token uses
are explicitly approximate last activity; projects count means direct memberships, including
archived projects, excluding board-only grants. No seats/quota or capacity is invented.

Instance invitations reuse existing email invitations with no project or board. They always
create members; only explicit admin mutations promote them. ADR 0019 link role limits are
unchanged. Pending invitations, resend and revoke reuse existing endpoints.
