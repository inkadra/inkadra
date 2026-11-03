# 0068 — Persist contextual card appearance

The approved contextual toolbar A needs shared presentation choices, not viewer preferences.
Document version 16 adds optional fields, with a no-op migration from version 15.

- Sections: `size` S/M/L (20/26/34 world units), `bold`, `italic`, `align`
  left/center/right, `color` from the dedicated section palette (blue, orange, purple, green, teal,
  yellow, red, pink), and `line`. Neutral is represented by omitting `color`;
  the four-colour card palette is unchanged.
  Omission preserves the old 20-unit, 600-weight, upright, left-aligned title with
  primary text and a visible rule. Explicit bold false means 400, true means 700.
  The future UI must create new headings with M and bold true to match the mockup;
  migration must not restyle existing headings.
- Links: `showInfo` and `showPreview`, independent booleans, both omitted = true.
  Info off renders only the address without deleting fetched metadata. Preview controls
  the embedded video region and loading its player; ordinary links ignore that switch.
- Files: `showPreview`, omitted = true, controls uploaded video previews only.
  Other file families retain their existing presentation.
- Images: `strokes`, omitted = empty, using the existing Stroke schema and limits.
  Coordinates refer to the full source image before crop and rotation; the drawing
  undergoes the same transforms as its image. Each x/y axis spans 0–4096 across
  the original width/height; line width is in thousandths of the source image width.
  Yjs stores strokes in a Y.Array, as for frames.

These presentation fields are included in the guest allowlist. They do not grant access
or delete underlying metadata/assets. Generic Yjs snapshots, readable JSON exports and
clipboard/duplicate operations preserve them. Older documents remain unchanged; the
version guard prevents an older server from loading and rewriting a version 16 document.
No API or database migration is required.

Inventory of the remaining mockup: geometry/grid fitting and rotation already have fields;
tables already store rows, columns, width and header; other card tools use existing fields.
Note formatting lives in the existing Y.XmlFragment `body`, copied as a Yjs update, not
parallel JSON fields. Schema 16 explicitly includes the `noteInk` mark (`color` and
`highlight`, each neutral/null or one of the eight section colors), `taskList` and
`taskItem` nodes (`checked`: boolean), and `textAlign` on paragraph/heading blocks
(null or left/center/right). `NOTE_BODY_FORMAT` records these persisted additions.

These rich-text changes are not backward compatible: y-prosemirror can delete marks
and nodes unknown to an older editor when it normalizes the shared fragment. A live
client must compare the document schema version with its supported version before
mounting an editor, stay read-only for newer documents and show an update-app notice.
Collaboration clients advertise `schemaVersion` in their WebSocket query. The server
keeps clients with absent/invalid or older versions read-only (including permission
rechecks), so already installed PWAs that predate the live-client guard cannot rewrite
schema-16 notes. New clients must send their actual supported version; native clients
and test seeders follow the same protocol. This only restricts writes, not reading.
Editor commands and renderers remain UI work; their persisted vocabulary is part of
this contract. The mockup names
“column type” as existing, but current tables contain plain text only and no such menu:
column types are outside the approved add/delete row/column scope, so no type enum
or menu is introduced. Dock tools and toolbar/focus state require no document data.

This PR supplies the contract only. Rendering, commands, note formatting, image drawing
editor integration, new-heading defaults and contextual toolbar/dock changes follow only
after maintainer review.
