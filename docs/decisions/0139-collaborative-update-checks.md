# 0139 — What the server checks in collaborative updates

Status: accepted (decided by the maintainer on 2026-11-23). Follows
[0011](0011-collaboration-and-access.md) (who may write) and [0102](0102-min-writer-schema.md)
(refused writes).

## Context

Editors send Yjs updates that the server applies to the board as they are. Yjs trusts its peers:
an update that no Yjs client writes can make the board fail to encode (so it is never stored
again), make applying it fail halfway through after changing the board, collide with the server's
own writes, or leave what the server holds in memory different from what it stores and sends.
Only people who can edit the board can send updates at all; they can already change or delete
any of its cards. Checking that every update is one a normal client would produce would mean
applying it to a second copy of the board first, which the maintainer judged too costly and too
complex for what it protects (#1001, #1009).

## Decision

- Before a collaborator's update reaches the board, the server refuses it when, read from the
  decoded update and the board's clocks alone, it cannot be decoded the way Yjs applies it, holds
  a struct or a deletion of no length, holds a struct naming a clock of its own client at or after
  its own, or writes new structs or deletes clocks not yet written under the board's own client
  id. Refusing closes the sender's sync as any refused write does.
- After every await in that path, and before Hocuspocus applies the update, the connection must
  still be writable: not read-only, its socket open, the board still loaded.
- The to-do checks (who can be assigned, due dates, guests and viewers) stay as they were.
- Beyond that, editors are trusted with the board's content: a crafted update from someone with
  edit rights can damage that board, or make memory and storage differ until the board is
  reloaded. SECURITY.md says so.

## Consequences

The checks cost about as much as decoding the update, which the server already does. A board
can't be wedged by one update, and no editor can write as the server. Damage an editor can do to
a board's content remains possible, as it is by editing it.
