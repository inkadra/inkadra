# 0117 · Set plan: the drawing surface and what a click picks

Proposed, 2026-11. Builds on decisions 0062 (the plan's 3:2 drawing), 0104 (stacking and
attachments), 0110 (walls) and 0116 (logic clients share lives in a package). The mockup approved
on 2026-11-11 (`Main`, `Phone`, `Snap`, `Viewing`) is the reference; the parity audit of `main`
found the editor's drawing a fixed 3:2 box and a click on a light picking its softbox.

## Context

The editor drew the plan as a box of the plan's aspect ratio, centred in the area between the
panels with empty bands round it; zoom grew the box from its top-left corner behind scroll bars,
and nothing panned. The mockup draws the plan on a surface that fills that area, the dot grid
everywhere, panned and zoomed. A click picked the item drawn on top, so a light with a softbox on
its front opened the softbox, and a stool under a seated person could not be picked at all.

## Decision

**The stored extent stays; the editor shows it as a quiet frame.** A plan's coordinates are
`STROKE_GRID` units of its 3:2 drawing, bounded to 0..4096 by the schema (`GridCoord`): an item
cannot be stored beyond the old box without a schema change, and the card on the board, the
exports, the slides and the call sheet draw that box. So nothing stored changes. The editor and
the read-only view draw the plan's extent as a thin frame inside a surface that fills their area,
with the dots of the plan's grid all over it; what is placed or dropped stays inside the frame as
before (a point outside is brought to its edge, a library tile let go outside is not placed).
The background picture may lie beyond it, as 0110 allows, and is drawn there.

**Pan and zoom** (`plan-view.ts` in canvas-core, the board's `Viewport`; `PlanSurface.tsx` in
the web):
- a drag on empty space, the middle button, or Space held pans; on a phone one finger on empty
  space pans and a long press draws the selection box, as before; Shift and a mouse draw the box
  that adds to the selection;
- the wheel zooms round the pointer (a notch is the board's step, a trackpad pinch is direct);
  Shift + wheel and a sideways swipe pan; two fingers pan and zoom round their middle, with the
  maths of the board's pinch;
- the zoom control steps through 25 to 800 % round the middle; 100 % is the whole extent fitted
  to the area; **Fit** frames what is on the plan (items, walls, the background), never closer
  than 250 %, and leaves free the bars floating over the surface; the plan opens fitted;
- at least 64 px of the extent stay in view, so the plan cannot be lost; there are no scroll bars;
- panning writes the frame's transform without a render, so a plan of 300 icons pans at the
  screen's rate; a change of zoom renders once a frame.

**What a click picks** (`planItemsAt`, `nextPlanItemAt`):
- the item drawn on top, except that a light comes before the modifiers on its front: a click on
  a light picks the light, its modifiers being in Properties ("On this light") and in Elements;
- a measure still yields to the icons its ends sit on (0104);
- a click again on the picked item, without moving, picks the next item under the pointer, round
  to the first: the softbox after its light, the grid after the softbox, the stool after the
  person sitting on it; a press there that moves drags the picked item, so a picked base is dragged
  with what it carries;
- Alt + click picks the item under the top one at once.
The same works with a finger: a tap on the picked item picks the next one under it when there is
one; when there is none, the tap takes it out of the selection as before.

**Shift + click** adds an item to the selection and takes a selected one out (unchanged; the
audit's two failures came from a test tool that does not hold Shift during a mouse click).

## Consequences

- The board's card, exports and the read-only legend are unchanged; existing plans draw exactly
  as before everywhere but in the editor and the view, which only frame and zoom them differently.
- Placing beyond the old box waits for a schema change that widens the coordinates; nobody asked
  for it yet.
- Modifiers are reached by a second click; a light whose softbox is far bigger than it is still
  picked by a click on the softbox's part that the light does not cover.
