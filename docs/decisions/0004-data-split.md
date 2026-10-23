# 0004 · Board content in Yjs, everything else in Postgres

Accepted, 2026-10.

**Context.** Boards are edited by several people at once and, on mobile, offline. Projects,
permissions and assets need relational queries and constraints.

**Decision.**
- Each board has one Yjs document named `board:<uuid>` with two root types: `meta`
  (`schemaVersion`, `boardId`) and `elements` (a map of element id to element map). Element
  types and fields are defined in `packages/doc-schema`; rich text lives in a `Y.XmlFragment`
  under `body`. Elements waiting in "Non ordinati" have `parent: "unsorted"`.
- The document carries a schema version; the collaboration server migrates documents when it
  loads them and refuses documents newer than itself. The schema freezes at 1.0.
- The latest state is stored compacted in `board_doc` (one row per board).
- Postgres holds users, sessions, projects, boards (tree via `parent_board_id`, one root per
  project), roles and assets. Sibling order uses fractional indexes (text keys), so moving an
  item never renumbers the others.
- Roles are `owner`, `editor`, `commenter`, `viewer` on the project; a `board_grant` can
  override them for a board and its sub-boards. Only `editor` and above can write to a board
  document; others connect read-only.

**Consequences.** Search and reports over board content need an index fed from the
documents (wave 2). Whether the shot list moves into Yjs is decided in wave 2 with a prototype.
