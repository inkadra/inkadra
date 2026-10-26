# 0023 · Home overview from two read-only lists

Accepted, 2026-10.

**Context.** Home is the daily starting point: the boards someone was working on and, on a
shooting day, the day's call. Boards are listed per project and shooting days per board
(0022), so building Home from them would take one request per project or board. A board's
`updatedAt` changes on renames and moves only; document edits move `board_doc.updated_at`.

**Decision.**
- `GET /me/recent-boards` lists boards of projects that are not archived, ordered by
  `editedAt`, the later of the board's and its document's change. Candidates are boards of
  the person's projects and the subtrees of their grants; the role shown comes from the same
  rule as opening the board (0011), which also leaves out anything they cannot open.
- `GET /me/shooting-days?from&to` lists days of a local date range, at most 62 days, in
  projects that are not archived. Every day is checked against its board with the viewer rule
  of `GET /boards/{boardId}/schedule`, as 0022 asks of a project overview. The client asks
  for its own local date: dates have no timezone (0022).
- Both are additive v1 endpoints, not paged, with `nextCursor: null` so they can page later.
- Items without a server source stay out of Home rather than being approximated: unsorted
  cards live in each board's document, last editors and weather are not recorded.

**Consequences.** Home needs four requests whatever the number of projects. The last-edit
order follows stored documents, which the collaboration server writes a few seconds after an
edit. A Home summary of unsorted cards would need a server index of the documents (as the
search index of 0012), which is left for later.
