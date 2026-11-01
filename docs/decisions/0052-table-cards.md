# 0052 · Table cards

Proposed, 2026-11. Extends the board document (decision 0003 and later), guest fields (decision
0013) and exports (decision 0038). Issue #317.

**Context.** Production planning often needs a small grid on the board: who covers which area,
what to shoot, with a map link. The shot list and the schedule are tables, but they are bound to
frames and shooting days. People paste these grids from Google Sheets, Excel or Numbers.

**Decision.**
- Document version 11 adds the `table` element, a plain card (not a container):
  - `columns`: 1 to 20 `{ id, width? }`; `width` is in world units, and columns without one share
    what the card leaves (at least 80 each, then the card scrolls sideways).
  - `rows`: up to 500 `{ id, cells }`; `cells` maps column ids to plain text (at most 2,000
    characters each), a missing key being an empty cell.
  - `header` (the first row is a header row) and `color`, the tint of that row, from the card
    palette (decision 0033), set from the selection bar like a note's tint.
    Migration from version 10 changes only the schema version.
- **Yjs shape.** Columns and rows are Y.Arrays of Y.Maps and the cells of a row are a nested
  Y.Map, so two people typing in different cells, adding rows or columns, merge. Cells are keyed
  by column id, so reordering columns moves no text. Reordering a row copies it to its new place:
  an edit made to that row at the same instant elsewhere is lost, which is acceptable for a
  planning grid. A column's cells are removed with it.
- **Plain text only.** Web addresses in a cell are shown as links (host and ↗, new tab, `http`
  and `https` only); no formatting, formulas or merged cells. Editing is cell by cell, in plain
  inputs: arrows, Tab and Enter move, Tab or Enter past the last row adds one.
- **Clipboard.** A spreadsheet range pasted on the board makes a table; pasted into a cell it
  fills the table from that cell, adding rows and columns up to the limits. The TSV is read
  first (quoted cells with line breaks, as spreadsheets write them); an HTML table, parsed inert
  by the browser, is the fallback. A copied table card carries its TSV as plain text, so it
  pastes into a spreadsheet as cells. Importing CSV or XLSX files is left to #329.
- **Guests** see the whole table: it has no private fields. **Search** indexes every cell.
  **Exports** draw one line per cell with the header row tinted, as on the board.
- **Phones.** Rows are 44 px tall with a coarse pointer, and an edited table scrolls sideways
  inside the card.

**Consequences.** Builds before version 11 refuse boards with tables, as for every new element
type. Tables are bounded (20 × 500 cells of 2,000 characters) so a board document stays small
enough to sync; larger data belongs in a spreadsheet linked from the board.
