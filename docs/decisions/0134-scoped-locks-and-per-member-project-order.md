# 0134 — Scoped locks and a project order per member

Status: Proposed, 2026-11-19. For issue #818. Amends [0126](0126-delete-unused-classification-values.md)
(which lock orders a removal against project writes) and follows the capability pattern of
[0120](0120-board-writers.md) and [0122](0122-set-plan-sheet-from-the-server.md). Multi-tenancy
itself is out of scope.

## Context

One transaction-level advisory lock, `pg_advisory_xact_lock(10892)` (the "instance" or
"administration" lock), is taken by ten call sites. Each takes it for a different reason:

| Call site                                                          | What it actually protects                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects` (`projects-routes.ts`)                            | The new `project.position`, read as the instance-wide maximum and appended after it; the type checked against the catalog (0126); creation vs account deletion. |
| `PATCH /projects/:id` (`projects-routes.ts`)                       | The type checked against the catalog; lock order with account deletion ("takes this global lock before locking project rows").                                  |
| Import (`transfers/import.ts`)                                     | The final position (instance-wide maximum again) and account deletion. Taken at the end, after the transfer row, the project and board rows are written.        |
| `reviveUsed` (`classifications.ts`)                                | Read-modify-write of the `classifications` and `classifications_deleted` settings when a removed value comes back; after `classification-uses` (shared).        |
| `PUT /instance/classifications`                                    | The same two settings and the use count of a removal; after `classification-uses`, exclusive on every save (0126's prose says only on removals).                |
| `DELETE /me` (`account-routes.ts`)                                 | The owned projects, the "at least one active administrator" check, then files and totals locked in one order (#879).                                            |
| `PATCH /instance/members/:id`                                      | Role, deactivation and space of a person; the last-administrator check against other changes and deletions.                                                     |
| `PATCH /instance/settings`, `/storage-limits`, `/backups/settings` | Read-modify-write of one `instance_setting` row each, and the caller still being an active administrator.                                                       |

The global key also hides holes that a scoped key would expose:

- **Import** writes rows first (the transfer row `FOR UPDATE` in its fence, then `project`,
  `project_member` and boards, each taking `KEY SHARE` on the importer's `user` row, and
  `reviveUsed` from `writeBoardIndex` taking advisory locks), and only then `fits()` and 10892.
  An account deletion of the importer holding 10892 waits for those rows: a deadlock today, kept
  by a per-user lock. The catalog it uses for shot text is read before its transaction
  (`import.ts:343`).
- **`POST /projects`** runs in `idempotentCreation`, which deletes the person's expired
  `creation_request` row before 10892: the same cycle with the deletion's cascade. It never checks
  inside the transaction that the actor still exists or is active: a lost race ends in an
  unmapped FK error (`23503`, a 500) or a project made by a deactivated person.
- **`DELETE /me`** locks the owned projects without `ORDER BY`, and its final `DELETE FROM user`
  sets `created_by` to null on other projects and boards, locking them last. Only the global key
  keeps two deletions from running together.
- **Members** are also written by `PUT /projects/:id/members/:userId`, `acceptInvitation`
  (`invitations.ts`) and `POST /invitations` for an existing person (`sharing-routes.ts`, an
  upsert outside any transaction), none under 10892.

Neighbours already scoped stay as they are: `assertSpace` (`storage-limits.ts`) locks
`storage-limits:<user>`, or `storage-limits` for every upload once an instance total is set
(#799, with a commented shortcut). 10893 is reused by two writers that share no invariant (video
settings, the start-up cast merge).

`project.position` is one fractional index per project (`text COLLATE "C"`, no index), shared by
every member. `GET /projects` lists the caller's memberships (an inner join on `project_member`),
orders them by it (then id) and its cursor encodes it; `PATCH` with `position` moves the project
for everyone; creation and import read `max(position)` over **all** projects, a sort of the whole
table. The field is `Project.position` (`FractionalIndex`) in `packages/shared/src/projects.ts`,
in the OpenAPI document the mobile app is generated from. The web app does not send `position`;
groups (decision 0056) already have their own order per person in `project_group_item`.

For one studio this is fine: these writes are rare and short. In a shared cloud every tenant's
project creation, import, account deletion and admin action would wait on every other tenant's.

## Decision

### 1. One lock per invariant, in one fixed order

The single key 10892 goes away. The new locks are two-key advisory locks whose first key is the
lock class, so a hash in one class can never meet a lock of another level (the two-int key space
never collides with the one-bigint keys still in use). The keys and the order live in one module,
`apps/server/src/locks.ts`:

| Lock, in the order taken   | Key                                                   | Mode               | Taken by                                                                       |
| -------------------------- | ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| 1. `classification-uses`   | `hashtext('classification-uses')`, one key, unchanged | shared / exclusive | 0126; **plus** creation, type change and import, shared, before the catalog.   |
| 2. `classifications`       | `(10892, 1)`                                          | exclusive          | catalog save and `reviveUsed`: the two settings rows.                          |
| 3. `account:<user>`        | `(10894, hashtext(<user id>))`                        | exclusive          | anything that creates for, adds, changes or deletes that person (below).       |
| 4. Idempotency key         | `hashtextextended(<key hash>, 0)`, one key, unchanged | exclusive          | `rememberedCreation`, now after the locks above.                               |
| 5. `instance-roles`        | `(10892, 2)`                                          | shared / exclusive | exclusive for a change of role or activity; shared for every admin-only write. |
| 6. `setting:<key>`         | `(10892, 3)` administration, `4` storage, `5` backup  | exclusive          | each `instance_setting` read-modify-write.                                     |
| 7. Rows                    | `FOR UPDATE`                                          |                    | `user` → `project` (by id) → `project_member` → other rows.                    |
| 8. `storage-limits[:user]` | `hashtext(...)`, one key, unchanged                   | exclusive          | `assertSpace`, then only `asset` (by id) → `storage_total`.                    |

**Rule:** a transaction takes locks only in this order, may skip any, and never takes an earlier
one after a later one; no advisory lock after its first row lock, except the storage lock (8).
That one is a leaf: whoever holds it only inserts or finishes asset rows and updates the person's
total, and no path waits for it while holding a row an upload needs. So it can stay at the end of
an import, held only for the files, as #879 put it. Taking it first would hold the instance-wide
`storage-limits` key, once a total is set, for a whole import. Where several `account` locks are
ever needed, they go in ascending key, not id. Classes 10892 and 10894 are new; 377 stays release
news and updates; 10893 is left as it is.

What each path takes:

- **Creation** (`POST /projects`): `classification-uses` shared, `account:<actor>`, then the
  idempotency key: `idempotentCreation` gets a callback run before `rememberedCreation`. Then it
  re-reads the actor (exists, not deactivated; otherwise 401) before any insert. No other person
  waits.
- **Import**: at the start of its transaction, before the fence: `classification-uses` shared,
  then `reviveUsed` once for the type, tags and frame text of the whole archive (collected from its
  documents before the transaction), so the later calls in `writeBoardIndex` find nothing left to
  revive and take no lock; then `account:<importer>` and the same re-check of the importer (gone or
  deactivated: the run fails like a cancelled one). The fence, the rows, `fits()` and the assets
  follow. The shot text read before the transaction can stay there: a value removed meanwhile comes
  back archived through that same `reviveUsed`, as 0126 wants.
- **Project change**: `classification-uses` shared when `type` changes, otherwise no advisory
  lock; then the project row (`lockMembers`), before the member rows a deletion cascades to.
- **Account deletion**: `account:<self>`; then it reads its own role (a role change takes the same
  account lock, so it cannot move) and takes `instance-roles` exclusive if it is an administrator,
  for the last-admin check. Rows: its `user` row `FOR UPDATE` first, then every project it owns
  **or** created, `ORDER BY id FOR UPDATE`, then assets as today. Two deletions run in parallel and
  take shared projects in the same order; the final cascade only reaches rows below them.
- **Member change** (`PATCH /instance/members/:id`): `account:<target>`, then `instance-roles`
  always: exclusive when role or activity changes, shared otherwise (so the actor's in-transaction
  admin check cannot race their own demotion), then the target row.
- **Memberships** (`PUT /projects/:id/members/:userId`, `acceptInvitation`, `POST /invitations`
  for an existing person, which moves into one transaction): `account:<target>` before any row
  (the invitation `FOR UPDATE`, `lockMembers`), then a re-check that the target exists.
- **Settings**: `instance-roles` shared, then `setting:<key>`. Two settings no longer wait on each
  other; a demotion still cannot interleave with a write by the demoted admin.
- **Catalog save**: `classification-uses` exclusive (every save, as now), `classifications`, then
  `instance-roles` shared for its admin re-check.

The one known exception stays as its comment says: the hourly index backfill (`backfillIndex`)
locks the board before `reviveUsed`, and a rare deadlock there is retried an hour later.

A deadlock between these paths becomes impossible by the order; a wait is still bounded by the
pool's `lock_timeout` (#800).

### 2. Project order per member

`project_member` gets a nullable `position text COLLATE "C"`. The migration copies
`project.position` into every row, so every list looks exactly as before.

- `GET /projects` orders by `coalesce(project_member.position, project.position), project.id`
  (the fallback only for rows without one, as test fixtures write) and the cursor encodes that
  value. The list already joins the caller's membership: no new index.
- `Project.position` keeps its name and type; it now means "the caller's order". `loadProject`
  and every single-project response (create, `PATCH`, pin, group) return the caller's value.
- `PATCH /projects/:id` with `position` always writes the caller's `project_member.position`,
  never `project.position`, and needs only the viewer role (today editor, and it moved the project
  for everyone). Any other field in the same body still needs its role (editor, owner to archive);
  without it the whole request is refused and nothing is written. The key must pass `isOrderKey`
  (moved from `import.ts` to a shared server helper): `FractionalIndex` only checks the length, and
  an invalid key would break `generateKeyBetween` for every later addition. Otherwise 400.
- Creation and import set the creator's position after the maximum of **their own** member rows
  (`project_member_user_idx`), under `account:<actor>`: no instance-wide read. `project.position`
  gets the same value and is no longer written by a reorder; dropping it is a later cleanup.
- A new or re-activated membership (an ended row replaced) gets a position after the person's own
  maximum, under `account:<target>`; a change of role or end date keeps it.

The server advertises `PER_MEMBER_PROJECT_ORDER_CAPABILITY = 'per-member-project-order'`
(`packages/shared/src/projects.ts`) in `GET /api/v1/instance/version`. The app may offer
reordering to every role only when it sees it; without it, a reorder still moves the project for
everyone and needs editor, as today.

## Migration and tests

One schema migration (add the column, backfill in one statement, no `NOT NULL`, no index).
Restoring an older backup runs it too: `restoreBackup` applies this version's migrations after the
data. No document schema change. `position-collation.test.ts` lists `project_member`.

Every change lands with a test in `apps/server/src/http/*.test.ts` against the real Postgres;
races run with `Promise.all` over many rounds and assert no `40P01` and no 500:

1. **No global wait**: user A holds a creation transaction open after its locks; B's creation and
   import and an admin's settings writes finish under a short `lock_timeout`.
2. **Deletion vs creation**, with and without an `Idempotency-Key` whose row has expired: never an
   orphan project; the creation either commits first or answers 401.
3. **Deletion vs import** by the same person: the import commits first or fails cleanly.
4. **Deletion vs deletion**: two co-owners of the same projects, and two people each owning a
   project the other created.
5. **Deletion vs project change, member change, `PUT` member, invitation accept** for that person.
6. **Classification removal vs creation, type change and import** with that value: the removal is
   refused 409 `classification_in_use` or the write sees it (the 0126 tests, without 10892).
7. **Administrators**: two admins demote, deactivate or delete each other; a member promoted while
   deleting their account; an admin demoted while changing a setting or a person's space. One
   active admin remains; a write by a demoted admin is refused.
8. **Import vs upload** by the same person with a limit set: no deadlock, the limit holds.
9. **Order per member**: B's reorder does not move A's list; order kept after the migration and
   after restoring an older backup; a new member goes last, a role change keeps the place; an
   invalid key is 400; a viewer sending `position` with `name` gets 403 and nothing changes; the
   capability is advertised.
10. **Lock order**: a static test that no single-key `pg_advisory_xact_lock(10892)` remains and the
    call sites use `locks.ts`.

## Later: real multi-tenancy (out of scope)

Not decided here, listed so nothing above makes it harder. A `tenant` table and `tenant_id` on
the root rows (`user` membership, `project`, `project_group`, `instance_setting`, classifications,
audit events, `storage_total`, transfers, share links), with children reached through them and
probably row-level security. The single-instance concepts would split into operator and tenant:
instance settings (auth policy, SMTP, updates and the monitor stay the operator's), the `admin` /
`member` roles (a tenant admin under an operator), classifications per tenant, storage limits (the
instance total becomes per tenant, `assertSpace`'s global key with it), backups (one logical
archive per tenant beside the instance backup), release news and the demo. The singleton keys of
§1 would then become a class per kind with the tenant as second key.

## Options considered

- **Keep 10892 and document it.** Correct for one studio apart from the holes above, which need
  fixing anyway. Leaves #818 as it is and keeps every new feature tempted to reuse the global lock.
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
upgrade may repeat or skip a project once. The web and collab roles are single by lease
(`lease.ts`, `main.ts`) and an older server refuses a newer database, but a worker started before
the upgrade keeps running old code that still takes 10892 (imports): the release note says to
restart the worker together with the web (the split and office compose files run it apart).
