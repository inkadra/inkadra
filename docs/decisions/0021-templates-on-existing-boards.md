# 0021 · Templates on existing boards and real storyboard templates

Accepted, 2026-10.

**Context.** The empty-board Storyboard template inserted scene and frame elements into a
generic board, which has no Shot list view. Templates also became unreachable as soon as a
board contained a card.

**Decision.** Keep the empty-board picker and offer the same templates in the `/` command
palette for editors. Insert layouts near the viewport centre, reserving their full width and
estimated height and moving below intersecting content. Bring the inserted layout into view.

The Storyboard template creates a child board of kind `storyboard`, places its board card in
the current document, and opens it. Navigation carries a one-time initialization request.
After the child's normal collaboration connection syncs and confirms edit access, initialize
its empty document with one translated scene and three frames in one local undo step. Clear
the navigation request immediately afterward. Never initialize over existing content.

**Consequences.** Storyboard, Shot list and canvas are views of the same seeded document.
Initialization uses existing REST board creation and normal Yjs edits, with no API, database
or document schema changes. Creating a child board still requires a connection to the server;
the other templates remain local document edits. Undo in the parent removes its card, as for
toolbar-created boards; it does not delete the child board.
