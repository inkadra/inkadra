# 0119 · Set plan: 100 % is the plan fitted, room sizes, shooting days for the sun, the editor's choices in the account

Proposed, 2026-11. The last parity pass of the set plan against the mockup approved on
2026-11-11, after decisions 0104, 0110, 0111, 0114, 0115, 0117 and 0118. No schema change.

## Context

A second audit of `main` against every artboard (light and dark, 1440, 1280 and 390 px) found the
zoom reading about 146 % on a plan just opened and fitted where the mockup reads 100 %; the room's
size ("8.0 m", "6.3 m") written only while the room was picked, where the mockup draws it as part
of the plan; a phone fitting everything drawn, so the room was small; the sun's date a bare date
picker where the mockup offers "Day 3 of the shoot"; and the editor's personal choices (snap to
the grid, the phone's Snap toggle, the earlier positions, the layers hidden for oneself, the
library's category) lost on a reload, against Matteo's rule that personal choices live on the
server (2026-11-11).

## Decision

**100 % is the plan fitted.** The zoom control reads the zoom as a percent of the one Fit gives
(`fitPlanView`), which is also the view a plan opens with, so a plan just opened reads 100 % in
the editor and in the read-only view, and the buttons step from there (150, 200 … and 75, 50 …).
The limits stay where decision 0118 put them, 25 to 800 % of the old extent fitted, so how close
one can go does not depend on how much is drawn; the buttons turn off at those limits. What is
stored does not change. This replaces decision 0118's "100 % being the old extent fitted".

**A room with a scale shows its size.** A closed wall on a plan with a scale draws its width over
the top and its depth down the left, outside the walls (`planRoomDims`), in the editor, the
read-only view, the card on the board, board exports and the plan sheet, where "Scale and sizes"
turns them off with the scale. They need metres, so a plan without a scale draws none; the size of
a picked room is then shown at the nominal scale while it is picked, as before. Fit and the frame
of the outputs (`planFrame`) take them in. They are derived, never stored. A per-plan switch to
hide them would need a new field of the plan (a schema change): not built; the Set layer hidden
hides them. The mockup draws no rulers: rulers stay the plan's own choice (decision 0062), on by
default with a scale.

The lengths of a picked wall and of a picked opening are written outside a closed room too,
whichever way its corners were drawn.

**A phone fits the room.** On a phone, Fit (and opening) fills the width with the plan's closed
rooms when it has one, as the mockup shows the diner filling the screen; what lies outside them
(the village, a light through the window) is panned to. Without a closed room it fits what is
drawn, by width, as before.

**The sun's date is a day of the shoot.** The date of the sun offers the shooting days of the
board's schedule, read once from `GET /boards/{id}/schedule`, the endpoint `ScheduleView` reads,
and numbered as it numbers them (by date, from 1): only the days that shoot a shot of the plan's
scenes, or every day when none does or the plan serves no scene ("Day 3 of the shoot", with its
date beside it); "Today" and "Another date…", which opens the date picker. The stored value stays
the date (`sun.date`). Guests and previews read no schedule and keep the date picker. North reads
"Up, 0°": the way it points, in eight words, before its degrees.

**The editor's choices live in the account** (`UserPreferences`, additive in API v1, as
`shotGroupBy`): `planSnap` (snap to the grid, G), `planAttach` (icons attach to a base: the phone's
Snap toggle; Alt still places free for one drop), `planGhosts` (earlier positions shown),
`planHidden` (layers and Grip and crew hidden for oneself while editing, on every plan; a setup's
own hidden layers stay the setup's, for everyone) and `planShelf` (the library's category last
looked at). They follow the person to every device and through a reload; offline they last for
the page. Kept per session on purpose: the tool, the selection, the active layer, the base drawn as
a ghost behind a setup, the open tab and sheet, and the view (decision 0118). The read-only view's
legend has no state to keep. Nothing new is kept in the browser's storage.

**Smaller parities.** A counter or table counts its seats by their kind ("4 stools"); a light's
second line leaves out a level at 100 %; the start dialog writes sizes with one decimal ("8.0 m")
and "Start empty" is a bordered button; a reusable set named after its location is named once;
the PDF legend folds identical rows ("Practical ×3"), lists the grip standing on its own and
draws its glyphs without their labels; the power lines fold repeated names; a printed glow fades
towards its edge; the phone's Snap toggle is lit when on. A carried item's Properties no longer
offer "Select" for its base: a click again or Alt + click on the plan (decision 0118) and the
indented row of Elements (decision 0117) reach it.

## Consequences

- `UserPreferences` gains five fields; older clients ignore them.
- Existing plans with a scale and a closed room show its size on the card and in outputs, and are
  framed a little wider to hold it.
- The read-only view and the editor read 100 % when fitted; e2e and tutorials say so.
- Left open: an own note for the last blocking position (the mockup shows the item's note beside
  its positions; today they are one stored `note`) and a switch to hide the room sizes need schema
  changes.
