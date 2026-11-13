# 0118 · Set plan: a surface without edges, and what a click picks

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
the scene sheets, board exports and the plan sheet show the box of what is drawn: the items of
the layers shown (the plan's hidden layers, a setup's and the viewer's own left out), each with
everything drawn for it (`itemDrawnBox`: its label and a light's second line, its beam, cone or
glow, its earlier positions with their numbers and ways, a measure's chip), the walls and the
background picture where it is drawn, with a margin, widened to 3:2 and never narrower than 400
view units. When nothing is drawn, the old extent. Hit testing keeps the body's box (`itemBox`).
The card keeps its 3:2 shape and size. Plans drawn before are framed on what they hold rather than
on the old box, so most look closer; nothing stored changes. The plan sheet prints what the editor
showed when it asks for the visible area, else the frame, and its grid covers what it prints. The
words drawn by the icons (`iconLabel`, `iconSubLabel`, `wattsText`) live in canvas-core with the
frame, which measures them (decision 0116).

**The editor and the read-only view draw on a surface** (`plan-view.ts` in canvas-core, the
board's `Viewport`; `PlanSurface.tsx` in the web): the whole area, the dots of the plan's grid all
over it, no frame and no scroll bars. It moves as the board does (`Canvas.tsx`), so the two
surfaces of the app behave alike:

- with the Select tool, a mouse dragged on empty space draws the selection box (Shift adds to the
  selection), and a click there lets go of it; Space held, the middle button, a scroll (Shift
  turns it sideways) or two fingers pan;
- Ctrl/⌘ + wheel and a trackpad pinch zoom round the pointer, a wheel notch being the board's
  step; two fingers pan and zoom round their middle with the maths of the board's pinch;
- on a phone, as decision 0071 had it, a long press draws the selection box; a finger that moves
  before it pans, since a phone has no Space nor wheel;
- keys, as on the board and in the read-only view: + and − (with or without Ctrl/⌘) zoom, Shift+1
  or 0 fits, and the arrows pan when nothing is picked;
- the zoom control steps from 25 to 800 % round the middle, 100 % being the old extent fitted to
  the area; **Fit** frames what is drawn, never closer than 250 %, leaving free the bars that
  float over the surface; the plan opens fitted; a phone fits by width, from the top;
- the view keeps at least 64 px of the plan's reach in the area, so anything that can be placed
  can be panned to and framed, and the view never drifts where nothing can be;
- panning writes the transform without a render, so a plan of 300 icons pans at the screen's
  rate; a change of zoom renders once a frame.
  A picked closed room shows its size outside its walls ("8.0 m" over the top, "6.3 m" down the
  left), as the mockup draws it, next to the length of each side.

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
