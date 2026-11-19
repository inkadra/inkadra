# 0134 — Scoped locks and a project order per member

Status: Proposed, 2026-11-19. For issue #818. Amends [0126](0126-delete-unused-classification-values.md)
(which lock orders a removal against project writes) and follows the capability pattern of
[0120](0120-board-writers.md) and [0122](0122-set-plan-sheet-from-the-server.md). Multi-tenancy
itself is out of scope.

## Context

One transaction-level advisory lock, `pg_advisory_xact_lock(10892)` (the "instance" or
"administration" lock), is taken by eleven call sites. Each takes it for a different reason:

| Call site                                                          | What it actually protects                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects` (`projects-routes.ts`)                            | The new `project.position`, read as the instance-wide maximum and appended after it; the type checked against the catalog (0126); creation vs account deletion. |
| `PATCH /projects/:id` (`projects-routes.ts`)                       | The type checked against the catalog; lock order with account deletion ("takes this global lock before locking project rows").                                  |
| Import (`transfers/import.ts`)                                     | The final position (instance-wide maximum again) and account deletion; order: storage lock, then 10892, then asset rows (#879).                                 |
| `reviveUsed` (`classifications.ts`)                                | Read-modify-write of the `classifications` and `classifications_deleted` settings when a removed value comes back; after `classification-uses` (shared).        |
| `PUT /instance/classifications`                                    | The same two settings and the use count of a removal; after `classification-uses` (exclusive), "never before".                                                  |
| `DELETE /me` (`account-routes.ts`)                                 | The owned projects, the "at least one active administrator" check, then files and totals locked in one order (#879).                                            |
| `PATCH /instance/members/:id`                                      | Role, deactivation and space of a person; the last-administrator check against other changes and deletions.                                                     |
| `PATCH /instance/settings`, `/storage-limits`, `/backups/settings` | Read-modify-write of one `instance_setting` row each, and the caller still being an active administrator.                                                       |

Two neighbours are already scoped and stay as they are: `assertSpace` (`storage-limits.ts`) locks
`storage-limits:<user>`, or `storage-limits` for every upload once an instance total is set (#799,
with a commented shortcut), and 10893 orders video settings and the start-up cast merge.

`project.position` is one fractional index per project (`text COLLATE "C"`), shared by every
member. `GET /projects` orders by it (then id) and its cursor encodes it; `PATCH` with `position`
moves the project for everyone; creation and import read `max(position)` over **all** projects.
The field is `Project.position` (`FractionalIndex`) in `packages/shared/src/projects.ts`, in the
OpenAPI document the mobile app is generated from. The web app does not send `position`; groups
(decision 0056) already have their own order per person in `project_group_item`.

For one studio this is fine: these writes are rare, short, and serialising them is what made the
invariants above easy to prove. In a shared cloud every tenant's project creation, import, account
deletion and admin action would wait on every other tenant's, and the ordering read scans a single
global index.

## Decision

### 1. One lock per invariant, in one module

The single key 10892 goes away. Every lock becomes a two-key advisory lock
`pg_advisory_xact_lock(10892, <key>)` (the two-int key space never collides with the one-bigint
keys still in use), with `<key>` from a small set of helpers in one module
(`apps/server/src/locks.ts`), which also holds the order below in a comment:

| Lock (in the order taken)  | Mode               | Taken by                                                                                                                                                                    |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `classification-uses`   | shared / exclusive | unchanged (0126). **Plus** project creation, type change and import, in shared mode, before reading the catalog.                                                            |
| 2. `classifications`       | exclusive          | catalog save and `reviveUsed`: the two settings rows.                                                                                                                       |
| 3. `storage-limits[:user]` | exclusive          | unchanged (`assertSpace`).                                                                                                                                                  |
| 4. `account:<userId>`      | exclusive          | project creation and import by that person; their account deletion; an admin changing them. Several people: ascending id.                                                   |
| 5. `instance-roles`        | shared / exclusive | exclusive for a change of role or deactivation and for deleting an administrator's account; shared for every settings write, which re-checks the caller is an active admin. |
| 6. `setting:<key>`         | exclusive          | each `instance_setting` read-modify-write (`administration`, `storage-limits`, `backup`).                                                                                   |
| 7. Rows                    | `FOR UPDATE`       | `user` → `project` → `project_member` → `asset` (by id) → `storage_total`, as #879 already orders files.                                                                    |

**Rule:** a transaction takes locks only in this order, may skip any, never takes an earlier one
after a later one, and takes no advisory lock after its first row lock. That is the existing #879
order (storage, then instance, then rows) with the instance lock split into 4–6. What each old
call site keeps:

- **Creation and import**: `classification-uses` shared (a removal still sees the new use, or the
  creation sees the removal, as 0126 requires) and `account:<actor>` (a deletion either sees the
  project or the creation waits and then finds the actor gone). No other user waits.
- **Project change**: `classification-uses` shared when `type` changes; otherwise only the project
  row, which `lockMembers` already locks first, before the member rows a deletion cascades to.
- **Account deletion**: `account:<self>`, `instance-roles` exclusive if they are an administrator
  (the last-admin check), then rows as today.
- **Member change**: `account:<target>`, then `instance-roles` exclusive when role or deactivation
  changes, then the target row.
- **Settings**: `instance-roles` shared, then `setting:<key>`. Two different settings no longer wait
  on each other; a demotion still cannot interleave with a write by the demoted admin.

A deadlock between these paths becomes impossible by the order; a wait is still bounded by the
pool's `lock_timeout` (#800).

### 2. Project order per member

`project_member` gets a nullable `position text COLLATE "C"`. The migration copies
`project.position` into every row, so every list looks exactly as before.

- `GET /projects` orders by `coalesce(project_member.position, project.position), project.id`; the
  cursor encodes that value. A person seeing a project only through a board grant has no member row
  and falls back to `project.position`.
- `Project.position` keeps its name and type; it now means "the caller's order". Same field,
  additive meaning: an older client keeps sending and reading it.
- `PATCH /projects/:id` with only `position` writes the caller's member row and needs only the
  viewer role (today editor, and it moved the project for everyone).
- Creation and import set the creator's member position after the maximum of **their own** member
  rows, under `account:<actor>`: no instance-wide read. New members (invitation, transfer) get a
  position after their own maximum too.
- `project.position` stays and gets the same value as the creator's member position: older servers
  reading the database during a rolling update and archives (`project-archive.ts`) still find one.

The server advertises **`per-member-project-order`** in `GET /api/v1/instance/version`. The app
may offer reordering to every role only when it sees it; without it, a reorder still moves the
project for everyone and needs editor, as today.

## Migration and tests

One schema migration (add the column, backfill in one statement, no `NOT NULL`, no new index:
the list already filters by member). Logical backups carry the new column; restoring an older
backup leaves it null, which reads as today's order. No document schema change.

Every change lands with a test in `apps/server/src/http/*.test.ts` against the real Postgres:

1. **No global wait**: user A holds a creation transaction open after its lock; user B's creation,
   import and settings writes by an admin finish under a short `lock_timeout`.
2. **Deletion vs creation**: a creation and the creator's account deletion race (`Promise.all`,
   many rounds); never an orphan project, never a deadlock (`40P01`).
3. **Deletion vs project change and member change**, same shape, asserting no `40P01`.
4. **Classification removal vs creation/type change** with that type: either the removal is refused
   409 `classification_in_use` or the write sees the removal (the 0126 tests, rerun without 10892).
5. **Last administrator**: two admins demote or delete each other at once; one admin remains.
6. **Order per member**: B's reorder does not move A's list; old projects keep their order after the
   migration; the capability is advertised; a viewer can reorder only with it.
7. **Lock order**: a static test that no `pg_advisory_xact_lock(10892)` single-key call remains and
   that the call sites use `locks.ts`.

## Later: real multi-tenancy (out of scope)

Not decided here, listed so nothing above makes it harder. A `tenant` table and `tenant_id` on
the root rows (`user` membership, `project`, `project_group`, `instance_setting`, classifications,
audit events, `storage_total`, transfers, share links), with children reached through them and
probably row-level security. The single-instance concepts would split into operator and tenant:
instance settings (auth policy, SMTP, updates and the monitor stay the operator's), the `admin` /
`member` roles (a tenant admin under an operator), classifications per tenant, storage limits (the
instance total becomes per tenant, `assertSpace`'s global key with it), backups (one logical
archive per tenant beside the instance backup), release news and the demo. The lock keys of §1
then gain the tenant as a prefix, e.g. `setting:<tenant>:<key>`.

## Options considered

- **Keep 10892 and document it.** No work, no risk, and correct for one studio. Leaves #818 as it
  is and keeps every new feature tempted to reuse the global lock.
- **Scoped two-key advisory locks (recommended)**, as above. Small, local changes; each invariant
  gets a name and a test.
- **Row locks only** (`user` row for an account, `instance_setting` row for a setting). Natural for
  rows that exist, but a setting may not exist yet (upsert) and the catalog and order have no row
  to lock; mixing both kinds would need the same ordering rule anyway.
- **Keep one shared position, computed from the actor's own projects.** Removes the global read, but
  one member's reorder still moves everyone's list and shared projects interleave unpredictably.
- **A new `project_order` table.** Same data as a column on `project_member`, which already has one
  row per person and project and is deleted with the membership.

**Risks.** Splitting a lock that guarded more than its comments say: mitigated by writing down each
invariant (§1) and racing it in a test before the global key is removed. Cursors issued before the
upgrade may repeat or skip a project once. A rolling update runs old and new servers together: the
old one still takes 10892 and the new one does not, so the switch should ship in one release with
a note to update all replicas together.
