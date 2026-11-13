# 0125 — Cancel a transfer without removing a finished one

Status: accepted. Extends [0037](0037-export-import-and-backups.md) (project export and import)
and follows the capability pattern of [0120](0120-board-writers.md) and
[0122](0122-set-plan-sheet-from-the-server.md). This record is the contract; the route and its
tests come in the next pull request.

## Context

`DELETE /api/v1/transfers/{transferId}` does two things depending on the state it finds: a
transfer still `queued` or `running` is cancelled (`failed`, failure `cancelled`, the row stays);
one already `ready` or `failed` is removed with its archive. A client that only wants "stop it"
(the mobile app's Cancel button) has to read the transfer and then delete it. If the export
finishes between the two requests, the DELETE removes the archive the person was waiting for.

## Decision

**Route.** `POST /api/v1/transfers/{transferId}/cancel`, no body. It does one atomic update:
the transfer moves to `failed` (`cancelled`) only if it is still `queued` or `running`. It never
removes a row or an archive.

- **200** with the `ProjectTransfer` as it is now (`failed`, `cancelled`). The row stays in
  `GET /transfers`, as after a DELETE of a running transfer. A queued transfer never starts, and
  a queued import's uploaded archive is removed at once. A running one stops at the worker's
  next progress step, in whatever process runs it: its progress update matches no `running` row
  (or the once-a-minute heartbeat finds none and flags it) and the worker throws `Cancelled`. A
  cancelled export removes its incomplete archive. An import cancelled before its database
  transaction removes the files it already wrote to storage and leaves no project. The
  transaction itself is not interrupted: an import whose cancel lands during or after it keeps
  the new project, its owner can open it from the project list, but the transfer stays `failed`
  (`cancelled`) without its `projectId` and no "import ready" notification is sent. So for an
  import, a 200 does not guarantee that no project was created: a client that needs to know
  checks `GET /api/v1/projects` for the imported project.
- **409** `conflict` when the transfer is already `ready` or `failed` (for any reason). `details`
  is the `ProjectTransfer` as it is now, so the client can show the finished export or the
  failure without another request. Nothing changes.
- **404** `not_found` for an unknown transfer or one of someone else, as the other transfer
  routes.

**Race with completion.** The worker marks a transfer `ready` only while it is still `running`.
If a cancel commits first, that update matches no row and the cancel wins: the export's
finished archive is removed at once and the transfer stays `failed` (`cancelled`); for an import
see above. If the worker commits `ready` first, the cancel answers 409 with the ready transfer.
Either way the client gets one consistent answer and nothing it can still download is removed.

**Who.** The same as `DELETE`: only the person who started the transfer, with a session or a
personal token. No role check beyond that.

**Idempotency.** A second cancel finds the transfer `failed` (`cancelled`) and answers 409 with
it. A client that retries after a lost response treats a 409 whose `details.failure` is
`cancelled` as success; any other 409 means the transfer finished first and nothing was lost.

**Older servers.** Servers that answer advertise the capability `transfer-cancel`
(`TRANSFER_CANCEL_CAPABILITY` in `packages/shared`) on `GET /api/v1/instance/version`. An older
server answers the unknown route with 404, the same as an unknown transfer, so only the
capability tells them apart. Without it the app keeps using `DELETE` as today.

## Not covered

- `DELETE` keeps both meanings: the web app uses it for "Cancel" on a running transfer and
  "Remove" on a finished one, from the state it shows, and does not change.
- No `cancelled` value in `TransferStatus`: a cancelled transfer stays `failed` with failure
  `cancelled`, so installed clients keep reading it.
