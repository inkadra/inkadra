# 0104 · Set plan v2: model and drawing

Proposed, 2026-11. Extends decisions 0062 (set plans) and 0071 (the simpler editor), under the
writer rule of decision 0102. The mockup approved on 2026-11-11 (catalogue, plan, snapping,
inspectors, kit, phone) is the reference; this record is its model. The editor, the walls and
openings tools, the links in the interface and the outputs come in later pull requests.

## Context

The set plan of decision 0062 drew 42 line icons at fixed sizes, all with a veil of their colour,
in the order they were placed. In use, a person behind a table or a softbox in front of a light
read badly; lights, modifiers and stands had no fields for the crew (watts, gel, stand, circuit);
walls were pen strokes; and values that already live in Inkadra (the character an actor plays,
the frame a camera shoots, the location) were typed again on the plan.

## Decision

**Schema version 23**, with a migration that changes only the version (every field is optional,
every kind of version 22 stays valid). `WRITER_SCHEMAS` gets `23: { min: 23 }`: no test proves
that a client of schema 22 keeps what it does not know through paste, duplicate and edits, so
older clients stay read-only, as decision 0102 makes the default.

**Catalogue.** 163 kinds in 15 groups under 6 categories of the library's rail (lights; modifiers
and grip; camera and movement; people; set and props; sound and video), all seen from above,
facing right, generic types only. One glyph per kind in canvas-core (`plan-glyphs.ts`, ported from
the mockup's `Icons.dc.html`, centred on 0,0 in a -20..20 box) draws the library tile, the plan on
the board and in the editor, and the exports. Names and search words are in the six catalogues.

**Kinds of earlier versions keep their ids**, and where a kind is now another entry of the
catalogue it is drawn with that glyph:

| Kind              | Now drawn as                 | Note                                                                                                      |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `light` (v14)     | Fresnel                      | readable, no longer offered                                                                               |
| `recorder` (v15)  | Sound cart                   | readable, no longer offered                                                                               |
| `led`             | LED panel                    |                                                                                                           |
| `camera`          | Camera (`cam` in the mockup) |                                                                                                           |
| `carrig`          | Car mount                    |                                                                                                           |
| `group`           | Extras                       |                                                                                                           |
| `frame`           | Diffusion frame              |                                                                                                           |
| `monitor`         | Monitor                      | "Video village" is its own kind (`village`)                                                               |
| `boom`            | Boom op                      | a person with the pole, on Camera as before                                                               |
| `practical`       | Table lamp                   |                                                                                                           |
| `softbox`, `para` | Softbox, Parabolic modifiers | a free one keeps the beam it had as a light; one attached to a light draws none of its own                |
| `sun`             | Sun                          | without the window of version 15                                                                          |
| `actor`           | Lead                         | faced down in version 15's drawing, right now; `rotation` still says where it faces, so plans do not turn |

Every other kind of version 22 keeps its id and gets the catalogue's glyph of the same name. Every
icon changes shape, as the whole catalogue was redrawn; none changes meaning, size or layer. The
library tabs are now the six categories (Furniture and Exteriors became Set and props).

**Layers** stay the five of version 15. Lights, modifiers, grip, stands and power are on Lights;
camera, movement, video and sound on Camera; people and the crew on Actors; the set, furniture and
exteriors on Set. Walls and openings are on Set.

**Fills are opaque.** A glyph part is filled with the icon's colour mixed into the paper (the
card's `surface-1`, on paper the printed theme's), so what is under it is hidden. The parts the
mockup leaves see-through stay so: the overhead frame (butterfly), the tent, the tripod's
footprint, the prompter's glass. A ring light's hole is the paper; a gel keeps its orange.

**Stacking by type**, bottom to top: 0 background, floor and walls; 1 furniture, props and
vehicles; 2 stands, supports and track; 3 lights, camera and grip; 4 people; 5 labels, measures
and notes (the Notes layer). An attached icon draws over its base; within a tier the plan's order
holds. An icon's optional `tier` (0 to 5) is what Bring forward and Send back set. Beams, cones
and blocking moves draw between tiers 1 and 2; numbers and labels last. Hit testing follows the same order (`planStack`), except that a measure yields the click to the icon its end sits on. Strokes and shapes not on Notes are tier 0, so texts and measures now
draw over icons.

**Attachments.** An icon may carry `on`, the id of the icon it is attached to. What attaches to
what: modifiers on the front of any light (several stack outwards: soft box, then doors or snoot,
grid, scrim or gobo, gel); people on chairs, armchairs, stools, sofas, benches, beds and vehicles,
facing the seat's front, seated (lying on a bed); lights on C-stands, combo, light and roller
stands, boom arm, truss, pole cat and goal post; a camera on a tripod, hi-hat, dolly, slider, jib,
crane or car mount; a dolly on a straight or curved track, along it only; flags, nets and frames
on a C-stand. Doors and windows go in walls as openings. The attached icon keeps its own x, y and
rotation, placed where its base says (`attachedPlacement`): moving, turning, copying and deleting
a base takes what is on it along; copying an attached icon alone makes a free copy; an `on` that
points at nothing or loops attaches nothing. Pulling an icon away detaches it (`pulledAway`,
`detachIcon`). Pure functions in `plan-attach.ts`; the editor wires them in a later pull request.

**Sizes when dropped.** Each kind has a real size (`DEFAULT_METRES`: a person, a chair and a
camera 0.5 m, a desk 1.4 × 0.7 m, a sofa 2 × 0.9 m, a bed 2 × 1.6 m, a softbox and a C-stand 0.9 m,
a track piece 1.5 m, a car 4.5 × 1.8 m…). With a scale an icon lands at that size; without one at
88 view units per metre, so a person is a medium symbol as before and the rest keep their
proportions to it. Everything stays resizable as in decision 0071. A person posed seated or lying
is drawn with those glyphs.

**Walls and openings.** A plan's `walls` are polylines (2 to 100 points, in STROKE_GRID units)
`thickness` view units thick (0.15 m by default), optionally `closed`, with a `label`. Its
`openings` (door, double door, sliding door, window, plain opening) belong to a wall by id, sit
`at` view units along it with a `width`, a door swinging to the `side` of the wall (left or right
of the way it is drawn) from its `hinge`. Renderers fill the outline of each piece between the
gaps, so an opening cuts its gap, and draw the opening's lines (`openingLines`). Both are plain
objects in a Y.Array, created with the card; at most 200 walls and 200 openings, as decision 0062
bounds strokes. A wall's removal removes its openings; a variant shows its base's walls.

**New fields.** Lights: `role` (key, fill, back, practical), `watts`, `make` (make and model, free
text), `gel` (text), `stand` (C-stand, combo, boom arm, rigged, floor, when it stands on no stand
icon), `kelvin`, `height` (m), `tilt`, `circuit`; modifiers are attachments. Cameras: `support`
(when it is on no support icon), `height`, `tilt`, `frameId`. Actors: `characterId`, `pose`
(standing, seated, lying). Any icon: `note`, which is also the note of blocking's last position
as before. Plans: `locationId`, `circuits` (name and breaker amps, up to 30), `voltage` (120 or
230, 230 when omitted), `background` (an uploaded picture's id, `opacity`, `grey`) and `north`
(degrees clockwise from the top). `power`, `beam`, `intensity`, `lens`, `steps` and the rest keep
working.

**Power.** `watts` is the number the maths uses; without it, the `power` text of version 15 is
read for one ("1,2K", "2 kW", "300 W", "650"), and a text that says no number counts as nothing.
The label shows `power` if written, else the watts. Amperes are watts over the plan's voltage,
summed per circuit; a circuit warns above 80 % of its breaker and is over above it; lights on no
circuit are counted apart (`planPower`). Computed every time, never stored. The kit list counts
watts, modifiers, gels and the stands and supports named on items that stand on no icon.

**Beams** are tinted by colour temperature, from the palette's orange at 2000 K and below to its
blue at 6500 K and above (`beamWarmth`); a light without `kelvin` keeps its own colour. Lamps,
lanterns, candles and fire glow all round instead of a beam (`iconGlow`).

**Links, never copies.** The plan stores ids and shows the linked card's live value: the
character's name as an actor's label, the frame's shot label and lens (parsed from the frame's
text; the camera's own `lens` wins on the plan and is never written back), the scenes' number,
title, setting and time, the location's name, setting, address and light notes. `plan-links.ts`
resolves them against the cards the caller can see, already cut to what a guest may see; a card
that is gone leaves the item's own text, and `unlinkCharacter` writes the name into the label
before a link is dropped.

**Guests** see the whole plan, new fields included (decision 0062's rule; whether kit and power
are for guests is still open). Walls and openings are left out when a variant hides its Set. A
background picture is a file the plan shows to guests. **Search** also indexes makes, notes and
the labels of walls and openings.

## Consequences

- Clients of schema 22 and older are read-only on version 23 documents.
- Existing plans keep their data and layers; every icon is drawn with the new glyph and fills,
  texts and measures draw over icons, and newly placed icons land at their real proportions.
- Exports draw beams and see-through parts with a fill opacity (the PDF and canvas renderers
  gained one on polygons); beams are flat there, with the gradient only on screen.
- Not in this record's pull request: the editor's new layout and snapping, the walls and openings
  tools, the background picture on the plan, the links in the interface, the setup in the shot
  list, the export dialog and sheet, the sun. They build on these functions.
