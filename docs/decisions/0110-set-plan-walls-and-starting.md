# 0110 · Set plan: walls, openings and starting

Proposed, 2026-11. Builds on decision 0104 (the model of set plan v2) and the editor of its
second pull request. The mockup approved on 2026-11-11 (start dialog, drawing walls and openings,
Background in the top bar and in Elements, Walls in the phone's tools) is the reference.

## Context

Decision 0104 stored walls, openings and a background picture, and drew them, but nothing in the
editor made them: walls were still drawn with lines and rectangles, an empty plan opened on an
empty sheet, and a plan of a location used before started from nothing.

## Decision

**Walls tool.** A click puts a corner; the second makes a wall, each further one adds a side, and
each is one change of the document, so undo takes back one side at a time. The side being drawn
shows its length and the angle at its corner (or with the horizontal for the first side), turns
by 90°, 45° or freely, and a length typed on the keyboard (or in the bar's field, on a phone)
gives it that length on `Enter`. A click on the first corner closes the room; `Esc` or **Done
with walls** ends. A picked wall shows the length of each side and its corners to drag, one
change per drag; its openings keep their share of their own side. Walls are on the Set layer:
the base's for a setup, never drawn on a hidden Set nor picked or drawn on a locked one.

**Thickness and lengths are metres through the plan's scale.** A plan without a scale reads them
at the nominal scale of decision 0104 (88 view units per metre, the one default icon sizes use),
and the first wall, ready room or reused set written on it sets that scale (or the reused plan's,
or the one that makes a large ready room fit), in the same change. What the tool showed in metres
stays true, and setting the scale later from a wall of known length with the Scale tool rescales
every reading without moving anything: a wall's thickness and points are view units.

**Openings tool.** The wall under the pointer takes the opening, kept whole on the side under the
pointer so it never runs round a corner (in the middle of a side shorter than it); its width and
its distance from both corners of that side show while it is placed, dragged along its wall or
picked. One change per opening placed or drag. A picked opening changes kind, width (typed),
side and, for a door, the end it swings from. The wall's gap is cut as decision 0104 draws it.

**Start dialog.** A plan with nothing on it (no items, walls or background, its base's Set
included) opens with a panel over the drawing, a sheet on a phone: reuse the Set of another plan
of the same location, draw the walls, trace an image, scan the room (shown as coming with the
phone app, disabled), a ready room (rectangle, L, U, a studio's three walls, an exterior with no
walls) at a typed width and depth, or **Start empty**. Anything on the plan closes it; the plan's
menu offers it again while the plan is empty. Plans of the same location are those linking the
same location card, or, when either has none, naming the same place (the location card's name,
else the location of a linked scene, compared without case); setups and plans with nothing on
their Set are left out. Reusing copies the walls, the openings and the items of the Set layer
with new ids, in one change; lights, cameras, actors and notes stay behind.

`shortcut:` the candidates are the plans of the open board, the only ones the web app reads
today, so a plan cannot reuse the set of a plan on another board of the project. Upgrade when
plans of other boards can be read with their access rules (the links of 0104's last pull
request need the same reading).

**Background picture.** Picked with the upload of the cards' pictures (no new upload code), it is
written when all its bytes have arrived, in one change, fitted in the middle of the drawing with
its shape kept, 40 % opaque and grey, and the editor goes into _place the background_: the
picture framed with four corners, dragged to move, a corner to scale with its shape kept, one
change per drag; **Done** locks it under everything again. Schema 23 (unreleased) gains its
placement (`x`, `y`, `w`, `h` in view units, all four or none, none meaning stretched over the
drawing as before) and `hidden`. Opacity, greys, show or hide, move and scale, replace and remove
are in the Background panel, from the top bar and from the Set layer in Elements. It belongs to
the Set: a setup shows its base's (`variantView`). The editor, the card on the board and the
read-only view draw it, and guests see it (decision 0104); slides, sheets and exports keep
drawing the plan without it, and `backgroundBox` gives an export that asks for it where it lies.

## Consequences

- Walls and doors drawn with lines keep working; the empty plan's hint now points at the Walls
  tool.
- A plan drawn without a scale gets one with its first wall. People who never set a scale see
  metres they did not ask for; the Scale tool corrects them from any wall of known length.
- Reusing the set of a plan on another board waits for the `shortcut:` above.
- Scanning the room waits for the phone app.
