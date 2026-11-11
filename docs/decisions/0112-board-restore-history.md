# 0112 — The server remembers the last restores of a board

Status: accepted. Builds on [0013](0013-board-versions.md) and
[0109](0109-board-restore-marker.md).

## Context

With decision 0109 a client that edited a board offline sees that `meta.restores` changed and
asks the person what to do with the edits it has not sent. The question has to say who restored
the board and to which version ("Giulia Bianchi restored it to 'Before client review' (10 March,
18:20)"), and how many restores happened if there were several. The versions list cannot answer:
the restored version and the backup the restore made can be renamed, named or pruned since, and
nothing in it says who restored what.

## Decision

A table `board_restore` keeps one row per restore that changed the board: the board, the count
the restore set in `meta.restores`, who restored it (`restored_by`, set to null when the account
is deleted), and the restored version's id, kind, name and creation time **copied at the
restore**. The version id has no foreign key: the version may be gone later, the row stays. Only
the last 50 rows of a board are kept; deleting the board deletes them. Nothing about the person
is copied: the name is read from the account when the list is read, and a deleted account reads
as null, never as its email.

Order and failures. The row is written after the document change, in its own transaction under
the board's version lock, and only when the restore changed the board (`writeVersionOver`
returns the count, or null when nothing was counted). A row is never written for a restore that
did not happen in the live document. Because of that order, connected clients can receive the new
count a moment before its row is saved: a client that finds no row for a count it has seen asks
again for a few seconds, then shows the restore without details. If the insert fails it is tried
once more; if that fails too, the restore stands, the failure is logged with the board id and
count only, and the client sees fewer rows than the counts differ by. A durable outbox would close
that gap; it is not built until records go missing in practice.

Rows are upserted on (board, count): a row with the same count is replaced, every other row
stays, whatever order rows are saved in. The board worker runs several jobs at once, so two
restores of one board can save their rows out of order; neither removes the other. The live
document is stored after the collaboration server's usual debounce, so a process that dies in
between can leave a row whose restore was never stored; the next restore sets the same count and
replaces it. A writer that sets the count back (decision 0109) does not erase the history either:
the next restores replace only the rows with their own counts. The 50 rows kept are the most
recently saved ones. Rows with a count higher than the document's are ignored by clients.

`GET /api/v1/boards/{boardId}/restores?after=<count>` lists the rows with a higher count, newest
first. It needs viewer, the role that reads the document and its count. Who restored and which
version are for editors and owners, the role that lists versions; below it both are null and
only the counts and times are sent. Guests and share links have no route to it. The capability
`board-restore-history` on `GET /instance/version` tells clients the list exists. A row with a
count higher than the count the client read in the document belongs to a restore not stored
yet, or lost: the client ignores it.

Instance backups dump every table, so the rows go with them, in the same snapshot as the
documents; a backup restores only into an empty database, so no other instance's rows mix in.

## Not covered

- Project archives (export and import) do not carry the rows: an imported board keeps its
  `meta.restores` with no history behind it, and clients read "restored, details unknown".
- Restores that happened before this change have no rows.
- More than 50 restores missed offline: only the newest 50 are listed; the counts still say how
  many.
- No interface on the web: the list is for clients that edit offline.
- No guarantee against a writer that sets `meta.restores` (decision 0109 still applies).
