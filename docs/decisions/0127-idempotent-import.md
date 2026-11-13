# 0127 — Retry a project import safely

Status: accepted. Extends [0037](0037-export-import-and-backups.md) (project export and import)
with the `Idempotency-Key` of [0098](0098-idempotent-creations.md) and
[0103](0103-idempotent-project-creations.md), and follows the capability pattern of
[0120](0120-board-writers.md) and [0122](0122-set-plan-sheet-from-the-server.md). This record is
the contract; the route and its tests come in the next pull request.

## Context

`POST /api/v1/projects/import` receives the archive as the raw request body (`application/zip`,
not multipart and not tus), streams it to disk and only then inserts the transfer row and
answers 202. A client that loses that answer (the mobile app on a flaky network) cannot tell
whether the import was accepted. Retrying may start a second import and so a second project:
the one-import-at-a-time rule only refuses it while the first is still `queued` or `running`,
and then answers a 409 that does not say which import is running.

## Decision

**Key.** The optional `Idempotency-Key` header of 0098 and 0103, the same form (1–128 printable
ASCII characters, `ImportIdempotencyKey` in `packages/shared`). A header, because the body is
the archive. Clients send a new UUID for each archive the person picks and keep it for every
retry of that import. Scope: the person and `imports`. The key is stored in the existing
creation-request table, hashed with the person and scope, and committed in the same transaction
as the transfer row. No migration.

**Order of checks.** Sign-in, the project-creation check (403 `ProjectCreationDenied`), imports
available, Content-Type (415) and Content-Length (411) run on every attempt, retries included,
as in 0098. Then the key is looked up, under an advisory lock on its hash. Only when it is new do
the one-import-at-a-time check (409), the size limit (413) and receiving the archive follow. So
a retry while the first import is still queued or running gets that import, not the 409.

**Replay.** The same person with the same key gets **202** with `Location` and the transfer of
the first import **as it is now**, the same answer as the first request, whatever its status:

- `queued` or `running`: the client keeps polling it;
- `ready`: `projectId` is the imported project;
- `failed`, `cancelled` included: the client shows the failure. Trying again is a new import
  the person asks for, with a new key.

A replay starts nothing and does not read the archive: the server answers before reading the
body. Like 0098 it remembers only the transfer id, never a stored response.

**Changed request.** The archive is not compared, because a replay is answered without
receiving it. The fingerprint is the declared Content-Length: the same key with another
Content-Length answers **409** `conflict`, as a changed payload does in 0098.

**Removed transfer.** If the transfer of the key was removed (`DELETE /transfers/{id}`), a retry
answers **404** `not_found` and starts nothing, as a retry after a deletion does in 0098. Starting
a new import would be unsafe: a removed import may already have created its project (a ready
import's project stays when its transfer is removed, and an import cancelled during its database
transaction keeps its project, decision 0125). The client drops the queued import.

**Two requests at once.** If a retry arrives while the first request is still being received,
there is no row yet: both receive their archive. Whichever commits its transfer first wins; the
other finds the key under the lock, discards its archive and answers like a replay. One
transfer, one project.

**Lookup.** `GET /api/v1/transfers/import-requests/{idempotencyKey}` (key percent-encoded)
answers **200** with the caller's transfer of that key as it is now, or **404** `not_found` when
the caller has none: never received or still being received, another person's key, transfer
removed, or key expired. Only the caller's own: the key is hashed with the person, so another
person's key is indistinguishable from an unknown one. It lets the app ask "was it accepted?"
without sending the archive again: on 200 it follows that transfer; on 404 a POST with the same
key is safe (if the first request is still arriving, the race above keeps one import). The
recommended retry is therefore lookup first, then POST only on 404.

**Retention.** Keys are remembered for seven days, as in 0098, which is also how long
`GET /transfers` lists a transfer. Upload housekeeping removes expired keys. After that, a POST
with the old key starts a new import and the lookup answers 404; the transfer itself stays
readable by its id (`GET /transfers/{transferId}`) for as long as its row exists. Deleting the
account removes its keys.

**Older servers.** Servers that honour the key and answer the lookup advertise the capability
`idempotent-import` (`IDEMPOTENT_IMPORT_CAPABILITY` in `packages/shared`) on
`GET /api/v1/instance/version`. The existing `idempotent-creations` and
`idempotent-project-creations` keep their meaning. An older server ignores the unknown header
(no 400): it imports again on every request, refused only by the one-at-a-time 409 while an
import is active. It answers the lookup route with 404, like an unknown key, so only the
capability tells them apart. Without it the app keeps today's behaviour: after a lost answer it
can only read `GET /transfers` before retrying.

## Not covered

- Exports: `POST /projects/{projectId}/exports` already returns the export of the same project
  that is queued or running.
- Resumable uploads (tus) for archives: a retry before the first request commits sends the whole
  archive again; the later copy is discarded.
