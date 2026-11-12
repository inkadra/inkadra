# 0117 · Set plan: a surface without edges, and what a click picks

Proposed, 2026-11. Builds on decisions 0062 (the plan's 3:2 drawing), 0104 (stacking and
attachments), 0110 (walls), 0102 (writer schemas) and 0116 (logic clients share lives in a
package). The mockup approved on 2026-11-11 (`Main`, `Phone`, `Snap`, `Viewing`) is the
reference. Matteo decided on 2026-11-12 that existing plans may be framed differently from before,
as long as nothing of them is lost.

## Context

The editor drew a plan as a box of the plan's 3:2 aspect, centred in the area between the panels
with empty bands round it; zoom grew the box from its top-left corner behind scroll bars, nothing
panned, and nothing could be placed beyond the box: the schema bounds a plan's coordinates to its
3:2 extent (0 to 4096 `STROKE_GRID` units). The mockup draws the plan on a surface that fills
the area, the dot grid everywhere, panned and zoomed, with the room where it is drawn. A click
picked the item drawn on top, so a light with a softbox on its front opened the softbox, and a
stool under a seated person could not be picked at all.

## Decision

**Schema version 25: a plan reaches beyond its extent.** The icons' and blocking steps' `x, y`,
the strokes' points, the shapes' corners and the walls' points of a plan may lie up to
`PLAN_REACH` (4 × 4096 units, four times the old extent) beyond it on every side
(`PLAN_COORD_MIN` to `PLAN_COORD_MAX`). The 3:2 extent is now only the unit coordinates are
counted in: view units, the nominal scale and every stored value keep their meaning, and frame
drawings keep their own bounds. The migration from 24 changes only the version.
`WRITER_SCHEMAS` gets `25: { min: 25 }`: a client of schema 24 would leave out, when it reads, an
item lying beyond the extent, and could then write a plan without it, so it stays read-only, as
decision 0102 makes the default. The editor keeps an item within the reach (`clampGrid`,
`toPlanGrid`, `encodeStroke` with a `reach`).

**Outputs frame what is drawn** (`planFrame`): the card on the board, the slides, the call sheet,
the scene sheets, board exports and the plan sheet show the box of the plan's items and walls
(and the background picture where it is drawn), with a margin for labels, widened to 3:2 and
never narrower than 400 view units; an empty plan shows the old extent. The card keeps its 3:2
shape and size. Plans drawn before are framed on what they hold rather than on the old box, so
most look closer; nothing stored changes. The plan sheet prints what the editor showed when it
asks for the visible area, else the frame, and its grid covers what it prints.

**The editor and the read-only view draw on a surface** (`plan-view.ts` in canvas-core, the
board's `Viewport`; `PlanSurface.tsx` in the web): the whole area, the dots of the plan's grid all
over it, no frame and no scroll bars.
- a drag on empty space, the middle button, or Space held pans; on a phone one finger on empty
  space pans and a long press draws the selection box, as before; Shift and a mouse draw the box,
  adding to the selection; a click on empty space lets go of the selection;
- the wheel zooms round the pointer (a notch is the board's step, a trackpad pinch is direct),
  Shift + wheel and a sideways swipe pan; two fingers pan and zoom round their middle with the
  maths of the board's pinch;
- the zoom control steps from 25 to 800 % round the middle, 100 % being the old extent fitted to
  the area; **Fit** frames what is on the plan, never closer than 250 %, leaving free the bars
  that float over the surface; the plan opens fitted;
- at least 64 px of the old extent stay in view, so the plan cannot be lost;
- panning writes the transform without a render, so a plan of 300 icons pans at the screen's
  rate; a change of zoom renders once a frame.

**What a click picks** (`planItemsAt`, `nextPlanItemAt`):
- the item drawn on top, except that a light comes before the modifiers on its front, so a click
  on a light picks the light; its modifiers are in Properties ("On this light") and Elements;
- a measure still yields to the icons its ends sit on (0104);
- a click again on the picked item, without moving, picks the next item under the pointer, round
  to the first: the softbox after its light, the grid after the softbox, the stool after the
  person on it; a press there that moves drags the picked item, so a picked base is dragged with
  what it carries;
- Alt + click picks the item under the top one at once.
  With a finger, a tap on the picked item picks the next one under it when there is one; when there
  is none, the tap takes it out of the selection, as before.

**Shift + click** adds an item to the selection and takes a selected one out, as before (the
audit's failures came from a test tool that does not hold Shift during a mouse click).

## Consequences

- Clients of schema 24 open boards of version 25 read-only until they update.
- Plans already drawn are framed on their content on the card and in every output.
- The board's card stays 3:2: a plan much wider than tall shows with bands above and below.
- A softbox far bigger than its light is still picked at once where the light does not lie under
  the pointer.
