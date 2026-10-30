# 0043 · Arrow labels and styles

Proposed, 2026-10. Extends the arrow element of the board document in document version 6.

**Context.** Arrows already carry an optional `label`, a `line` (solid or dashed) and `heads`
(end, both, none), but the canvas offers labels only through a double click and styles through
two unlabeled toggles. Mind maps and relationship boards (who knows whom, which location
follows which) also need curved connectors, so lines between neighbouring cards do not run
through each other or through labels.

**Decision.**
- Document version 6 adds optional `path` to arrows: `straight` (the default when omitted) or
  `curved`. A curved arrow is a quadratic curve that bows to the left of the direction from
  `from` to `to`; the bow is a share of the arrow length chosen by renderers, not stored, so
  arrows keep following their cards without a control point to update. Its label sits at the
  middle of the curve.
- Migration from version 5 changes only the schema version: existing arrows stay straight.
  The bump keeps older builds, which strip fields they do not know when copying, from
  straightening curved arrows.
- `label`, `line` and `heads` keep their meaning. The canvas edits the label inline on the path
  (double click, Enter, or the Label button of the selection bar) and shows it on a chip with
  the surface colour, so the line never runs through the text. Styles live in the selection
  bar: line, ends (none, one, both) and path. Colours stay neutral (secondary text, the accent
  only while selected); arrows gain no colour field.
- Labels and paths are part of what guests see and of PDF and image export, like the arrow
  itself; an arrow attached to a card left out of a guest view or an export is still dropped.

**Consequences.** Older builds reject version 6 documents instead of losing curves. No API,
database or archive format change: the label was already in the document and in the search
index.
