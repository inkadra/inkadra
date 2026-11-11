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
did not happen in the live document. If the insert fails the restore stands: the failure is
logged with the board id and count only, and the client sees fewer rows than the counts differ
by. The live document is stored after the collaboration server's usual debounce, so a process
that dies in between can leave a row whose restore was never stored; the next restore sets the
same count, and inserting a row deletes the board's rows with the same or a higher count. The
same rule absorbs a count a writer set back (decision 0109), and keeps counts unique per board.
Two collaboration processes restoring one board at the same moment can both set the same count;
the later row replaces the earlier, as the document holds one count for both.

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
