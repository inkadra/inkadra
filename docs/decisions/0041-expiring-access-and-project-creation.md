# 0041 · Expiring access and who can create projects

Accepted, 2026-10.

**Context.** Studios bring in people for a limited time: a colourist for two weeks, a client
until delivery. Today their role stays until someone remembers to remove it. Some instances
also want only a few people to start projects, while everyone keeps working in the projects
they are invited to. Guest links (decision 0013) already expire; roles of people with an
account (decision 0011) did not.

**Decision.**
- **End dates.** `project_member.expires_at`, `board_grant.expires_at` and
  `invitation.access_expires_at` (copied to the membership or grant when the invitation is
  accepted or gives the role at once). Optional, in the future, at most 366 days ahead.
  Owners never have one: a project always keeps an owner, and a database check refuses an
  owner row with an end date. Making someone owner clears it; an owner grant takes none.
- **Who sets it.** Setting an end date, or moving it earlier, narrows access: on memberships
  owners do it (like every change to an existing member), on grants and invitations whoever
  can give that role (decision 0011). **Removing or extending** one widens access, so it is
  for **project owners** only, also on grants. `PUT` with `expiresAt: null` removes it;
  leaving the field out keeps it, so older clients changing a role do not drop an end date
  they do not show.
- **Invitations and roles already held.** An invitation only ever raises a role. It never
  replaces a permanent role with a temporary one (the person would lose everything when it
  ends): accepting keeps the permanent role, and inviting such an account by email is
  refused with 409. On a temporary role it raises the role but keeps the earlier of the two
  end dates, so it never removes or extends one. An invitation whose access end has passed
  shows as expired and cannot be accepted.
- **When it ends.** Access checks treat a row whose `expires_at` has passed as absent, in the
  same queries that read roles. The collab server's 30-second re-check (decision 0011,
  "Revocation") therefore closes or downgrades open connections without waiting for any job:
  a membership disappears, a grant falls back to the inherited role. A **sweep** then deletes
  expired rows and writes the notifications. It runs every minute as a BullMQ repeatable job,
  or on a timer inside the web process when there is no Valkey. It is idempotent: each row is
  deleted and notified in one transaction, with `for update skip locked`, so two workers or a
  restart never notify twice.
- **Notifications.** `access_expiring`, three days before (or at once when an end date is set
  closer than that), once per end date (`expiry_warned_at`, reset when the date changes); and
  `access_expired` when the sweep removes the row. Both go to the person and to the project's
  owners, carry `subject` and `accessExpiresAt`, and follow the email preference. The person
  keeps seeing them after losing access: the access filter lets through these two types when
  the recipient is the subject.
- **Who can create projects.** Instance setting `membersCanCreateProjects` (default true, the
  previous behaviour) and a per-account override `user.can_create_projects` (null follows the
  instance). Administrators always can. `GET /me` answers `canCreateProjects`; `POST
  /projects` and `POST /projects/import` answer 403 with `details.reason`
  `project_creation_disabled` (decision 0016) otherwise. Templates and the guided setup create
  projects through the same endpoint. Nothing changes for projects people are invited to, and
  turning the option off does not touch existing projects.

**Consequences.** Every query that reads `project_member` or `board_grant` to decide what a
person can see or do carries the `expires_at` condition (`activeMember`, `activeGrant` and
`live` in `access.ts`): role checks, search, schedules, recent boards, people search, storage
labels, share links acting for their creator and the account deletion check. A new query must
use them too; the sweep only removes rows and notifies, it is not what ends access. Clients
from before API 0.9.0 do not show end dates but keep them, and do not know the new
notification types, which they show as plain lines (decision 0013). Clients hide "New project", "Import project",
templates and the guided setup when `canCreateProjects` is false, with a line saying an
administrator decides; the server is what enforces it.
