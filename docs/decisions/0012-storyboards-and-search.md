# 0012 · Storyboards and shot lists live in the board document; search reads an index

Accepted, 2026-10.

**Context.** Decision 0004 left open whether the shot list moves into Yjs. A storyboard frame
and a row of the shot list are the same thing seen twice: the picture, the shot number and
the shot data. Directors reorder frames on the canvas and expect the shot list to follow;
crews tick shots on a phone with poor signal. Search and tags need to look across every board
of a project, which a Yjs document cannot answer on its own.

**Decision.**
- Board documents move to schema version 2, with three element types: `scene` (a container
  like a column, with number, INT/EXT, time of day, location and synopsis), `frame` (picture,
  shot data and pen strokes) and `arrow` (between two cards or free points, with a label).
  Every element can carry `tags`. `meta.aspect` holds the aspect ratio of a storyboard; a
  frame may override it. The change is additive: the 1→2 migration only bumps the version, so
  older servers refuse version 2 documents instead of dropping element types they do not know.
- **The shot list is a view of the frames in the board document**, not a table. Frames belong
  to a scene through `parent` and are ordered by their fractional index `z`, so moving a frame
  on the storyboard renumbers the shot list at once, offline edits merge like any other card,
  and there is one source of truth.
- Shot fields that have a common vocabulary (shot size, angle, movement, status) store a
  preset code that clients translate, or free text when nothing fits.
- Pen strokes are plain objects in a `Y.Array` under the frame, so two people can draw on the
  same frame. Points are relative to the picture, quantized to a 4096 grid, at most 1024 points
  per stroke and 2000 strokes per frame, so a frame cannot bloat its board.
- Postgres keeps `board_element_index`: one row per element with its searchable text, lower
  case tags, picture and a few plain fields (for frames: label, scene, status). The
  collaboration server rebuilds a board's rows in the same transaction that stores its
  document, and `board_doc.indexed_at` lets a maintenance job index boards stored before the
  index existed. Rows are never edited directly and go away with their board or project.
- Search matches parts of words with `pg_trgm` trigram indexes, which work the same for
  Italian, English and file names, without a language-specific stemmer. `pg_trgm` ships with
  PostgreSQL and is a trusted extension, so the migration creates it as the database owner.
- Board templates (moodboard, storyboard, location scout…) are written into a new document by
  the client with `@inkadra/canvas-core`, in the person's language. The API does not change.

**Consequences.** Views across boards (a project-wide shot list, a shooting schedule) read the
index and open the documents they edit. Search results can lag a few seconds behind the last
edit, until the document is stored. An external Postgres needs the `pg_trgm` extension
available (it is part of the standard contrib package).
