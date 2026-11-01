# 0062 · Set plans

Proposed, 2026-11. Extends the board document (decision 0003 and later), frame drawings
(decision 0012), guest fields (decision 0013) and exports (decision 0038). Issue #335.

**Context.** Filmmakers sketch lighting plans and blocking diagrams next to their references:
walls, a table, where the cameras look, where a light shines, where the actors stand. The pen
existed only inside storyboard frames, whose picture follows the frame's aspect ratio and sits
under a reference image.

**Decision.**
- Document version 14 adds the `plan` element, a plain card (not a container) with an optional
  `title` and three arrays over one drawing that is `PLAN_ASPECT` (3:2) wide per unit of height:
  - `strokes` and `shapes`: the frame drawing's `Stroke` and `FrameShape`, unchanged, in
    STROKE_GRID units of the drawing. The frame editor's model, encoding (`encodeStroke`),
    hit testing and renderers are reused; `addStroke` and `addShape` accept a plan as well.
  - `icons`: up to 300 set icons `{ id, kind, color, x, y, rotation?, label? }`. `kind` is one of
    camera, light, actor, door, window, table, track; `(x, y)` is the centre in STROKE_GRID units;
    `rotation` is whole degrees clockwise from facing right (0 to 359, omitted for 0); `label` is
    up to 60 characters ("A cam", "Anna", "Key 1,2K"). Icons of a kind this build does not know
    are left out when read, as frame shapes are.
    Migration from version 13 changes only the schema version.
- **Fixed geometry.** Renderers draw each kind at a fixed size from one description in
  canvas-core (`planIconParts`), shared by the board and the exports. A camera's view cone has a
  fixed length and angle (40°) in this version: changing the lens or the angle is not stored.
- **Yjs shape.** Strokes and shapes stay plain objects in Y.Arrays, as on frames; moving or
  turning one replaces it where it is. Icons are Y.Maps in a Y.Array, so two people moving and
  labelling different icons, or the same icon's different fields, merge. Two people moving the
  same stroke at the same instant may leave two copies, which undo removes.
- **Colours** are stored as hex codes like the frame drawing's, from a palette of five whose
  codes are those of tokens: ink (`text-secondary`) and the blue, yellow, purple and green tags.
  Renderers draw them with the theme's token, so ink walls stay readable on a dark card and the
  printed page uses the light theme. Any other code is drawn as it is.
- **Turning.** Icons turn with their `rotation`; strokes, lines and arrows turn by moving their
  points around their middle, measured in the same units across and down. Rectangles, ellipses
  and texts have no angle and stay upright.
- **Editor.** On a desktop it sits on the card itself: the tools to its left, the set icons to
  its right, the bar of the selected item (colour, label, rotate, duplicate, delete) under it,
  and the plan's own grid, which new points and icon centres snap to while the snap is on. On a
  phone it takes the whole screen. The tool, the selection and the snap are local.
- **Guests** see the whole plan: it has no private fields. **Search** indexes the title, icon
  labels and texts. **Exports** draw the plan as vectors, without the grid. Copy, paste and
  duplicate keep every stroke, shape and icon.

**Consequences.** Builds before version 14 refuse boards with plans, as for every new element
type. A plan is bounded (2,000 strokes, 500 shapes, 300 icons) so a board document stays small
enough to sync. The presentation shows storyboard frames only, so plans are not in it. An
adjustable cone, resizable icons and plans linked to a scene are left for later versions.
