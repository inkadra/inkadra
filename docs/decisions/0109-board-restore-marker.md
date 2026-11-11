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
client writes `meta` keys it does not know).

The marker is advisory, not a permission boundary. The server does not stop a client from writing
it, so any writer of the board can hide a restore from an offline client, not only cause a
needless question: a client last saw 3, a writer sets 2, a restore brings it back to 3, and the
client sees no difference. Such a writer can already change or delete the board's content, so
this gives it no new power. A client therefore treats any difference, a lower value included, as
a restore, and a server without the capability as "unknown", never as "no restore".

Not built: a server check that refuses client updates touching `restores`. It is the upgrade if
the marker ever has to hold against writers.

## Consequences

- The restore's single update now also carries the count, so whoever receives the restore
  receives the count with it, live or at the next sync.
- No database migration and no new endpoint.
