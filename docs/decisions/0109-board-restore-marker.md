# 0109 — A restore counts itself in the board document

Status: accepted. Builds on [0013](0013-board-versions.md) and [0102](0102-min-writer-schema.md).

## Context

A client that keeps a board document on the device and edits it offline (a phone on set) needs
to know, before it sends those edits, whether someone brought the board back to a saved version
in the meantime. The edits still merge (a restore is a normal change), but the person may prefer
to keep them aside rather than apply them on top of the restored board, and should be asked.

The versions list cannot tell it reliably: the backup a restore makes is renamed as soon as
someone names it, older ones are pruned, and comparing their `createdAt` with the device's last
sync compares the server's clock with the device's. The stateless `restored` notice reaches only
the clients connected at that moment.

## Decision

A restore that changes the board increments `meta.restores` (a whole number, absent before the
first) in the same transaction that writes the version over the board (`writeVersionOver`). A
restore that changes nothing is not counted. Only the server writes it; `getRestoreCount(doc)`
reads it (0 when absent or not a count). A version saved after a restore carries the count but
does not bring it back: the count only moves forward.

A client remembers the count it last confirmed a sync at. Before it connects as a writer with
offline edits, it reads the board as a reader: a different count means a restore happened since,
and it decides with the person before it sends. Servers that count advertise the capability
`board-restore-marker` on `GET /instance/version`; without it a client cannot tell and must not
assume no restore happened.

The key is not a schema change: older clients do not read `meta.restores` and leave it alone (no
client writes `meta` keys it does not know). It is not a permission boundary: a client could
write it, which would only make other clients ask a needless question.

## Consequences

- The restore's single update now also carries the count, so whoever receives the restore
  receives the count with it, live or at the next sync.
- No database migration and no new endpoint.
