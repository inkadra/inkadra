# 0119 · Set plan: 100 % is the plan fitted, room sizes, shooting days for the sun, the editor's choices in the account

Proposed, 2026-11. The last parity pass of the set plan against the mockup approved on
2026-11-11, after decisions 0104, 0110, 0111, 0114, 0115, 0117 and 0118. Schema version 26
(decision 0102), for three optional additions.

## Context

A second audit of `main` against every artboard (light and dark, 1440, 1280 and 390 px) found:

- the zoom reading about 146 % on a plan just opened and fitted, where the mockup reads 100 %;
- the room's size ("8.0 m", "6.3 m") written only while the room was picked, where the mockup
  draws it as part of the plan;
- a phone fitting everything drawn, so the room was small;
- the sun's date a bare date picker, where the mockup offers "Day 3 of the shoot";
- the last position of a blocking path sharing its note with the item;
- the editor's personal choices (snap to the grid, the phone's Snap toggle, the earlier positions,
  the layers hidden for oneself, the library's category) lost on a reload, against Matteo's rule
  that personal choices live on the server (2026-11-11).

An independent review then asked for links instead of copied dates, and for room sizes that hold
up with several rooms. The coordinator allowed one schema bump for this.

## Decision

**Schema version 26: three optional additions.** `WRITER_SCHEMAS` gets `26: { min: 26 }`: a client
of schema 25 would drop the new fields when it copies a plan, so it stays read-only.
- `sun.day` on a plan: the shooting day the sun's date follows, by id.
- `stepNote` on a plan icon: the note of the last blocking position, where the icon stands.
- `roomSizes` on a plan: false hides the rooms' sizes.

The migration from 25 moves the note of an icon with blocking from `note` to `stepNote`. Until
now `note` held the last position's note on such an icon (the Properties showed it as the last
position and hid the item's Note), so it keeps its meaning. Icons without blocking keep `note`.

**100 % is the plan fitted, pinned when it is fitted.** The zoom control reads the zoom as a
percent of the zoom Fit gave the last time the view was fitted: when the plan opens, on Fit, or
when the area changes before the person has moved the view. A panel opening or the window
resizing after a zoom or a pan never changes the number unless the zoom changes. The buttons step
from 100 % (150, 200 … and 75, 50 …). The limits stay where decision 0118 put them, 25 to 800 %
of the old extent fitted, so how close one can go does not depend on how much is drawn; the
buttons turn off at those limits. This replaces decision 0118's "100 % being the old extent
fitted". Nothing stored changes.

**Rooms and their sizes.** A room is a closed wall, or open walls that meet end to end in a loop,
followed whichever way each was drawn (`planRooms`). With a scale, each room draws its width and
depth outside its walls, on a free side: over the top unless another wall lies there, then under
the bottom; down the left, else on the right (`roomDims`). A room that is not a rectangle (an L,
a U) gets its overall width and depth, written "8.0 m overall". The sizes are worked out once per
list of walls, not on every render.

They are drawn in the editor, the read-only view, the card on the board, board exports and the
plan sheet, where "Scale and sizes" also turns them off. Without a scale there are no metres and
nothing is drawn; a picked room still shows its size at the nominal scale while it is picked.
While a wall or an opening is picked, the drawing leaves the room's size out, so the lengths of
the picked part do not overlap it.

`roomSizes` (version 26) is the plan's switch, on by default, in the scale menu next to Rulers. A
setup follows its base's switch, as it follows its walls.

One formatter writes the size everywhere (`roomSizeText`), in the app's language ("8,0 m" in
Italian), in the editor, the view, the card and the exports. The mockup draws no rulers: rulers
stay the plan's own choice (decision 0062), on by default with a scale.

**The PDF sheet fills its frame.** The plan is framed in the shape of the sheet's frame
(`planFrame` with the frame's aspect) with the card's small margin, instead of a 3:2 box inside a
near-square frame.

**A phone fits the room** by its width when the plan has one, as the mockup shows the diner
filling the screen. What lies outside the room (the village, a light through the window) is panned
to. Without a room it fits what is drawn, by width, as before.

**The sun's date is a link to a shooting day.** The days come from the board's schedule, read
from `GET /boards/{id}/schedule`, the endpoint `ScheduleView` reads. They are read once per board
and refreshed the way `ScheduleView` refreshes them (`whileVisible`: when the tab comes back and
every minute while it is in view), never on an edit of the board. They are numbered as the
schedule numbers them, by date from 1.

The list offers the days that shoot a shot of the plan's scenes, or every day when none does or
the plan serves no scene ("Day 3 of the shoot", with its date beside it). It also offers "Today"
and "Another date…", which opens the date picker. Choosing a day stores its id in `sun.day` and
its date in `sun.date`.

The plan shows and uses the day's live date and number, so a rescheduled day moves the sun with
it. When the day is deleted, the plan keeps the last date it had as a plain date and says so. A
date typed by hand is a date, with no day. Guests and previews read no schedule and keep the date
picker. North reads "Up, 0°": the way it points, in eight words, before its degrees.

**The editor's choices live in the account** (`UserPreferences`, additive in API v1, as
`shotGroupBy`):
- `planSnap`: snap to the grid (G);
- `planAttach`: icons attach to a base; this is the phone's Snap toggle, and Alt still places free
  for one drop;
- `planGhosts`: earlier positions shown;
- `planHidden`: layers and Grip and crew hidden for oneself while editing; a setup's own hidden
  layers stay the setup's, for everyone;
- `planShelf`: the library's category last looked at.

They follow the person to every device and through a reload. Quick changes are saved once they
settle (400 ms).

Someone with no account read this session, such as a guest of a share link, sends nothing and
keeps the choice for the page's session. So does someone whose save fails, offline for example:
the app's other preferences roll back on a failed save and do not retry, and this decision
invents no retry. The session's choices live outside the editor, so closing it or changing
setup keeps them.

`planHidden` holds group names (`set`, `lights`, `camera`, `actors`, `notes`, `grip`), not plan
ids. A hidden group is a way of working that holds on every plan, as the shot grouping holds on
every board. Six names exist and ten leave room for new groups. No plan id is stored, so nothing
accumulates and no plan a person can no longer open is named. A list read from the account keeps
each id once, even when the list is valid as a whole (`planFavorites`, `planRecents` and
`tutorialsSeen` too).

Kept per session on purpose:
- the tool, the selection and the active layer;
- the base drawn as a ghost behind a setup;
- the open tab and sheet;
- the view (decision 0118).

The read-only view's legend has no state to keep. Nothing new is kept in the browser's storage.

**What a click cannot reach.** A layer that is locked or hidden is out of reach on the drawing,
covered bases included: a click again or Alt + click passes over them, as over anything on that
layer (decision 0118's `reachable`). Elements keeps them reachable:
- a row of a locked layer shows the lock and how to unlock it, as before;
- a row of a hidden layer or of Grip and crew stays a focusable button, dimmed, and opens "Hidden:
  Lights · Show Lights", by pointer, touch and keyboard.

So a base under a carried item can always be reached. The carried item's Properties no longer
need their "Select" for the base.

**Smaller parities:**
- A counter or table counts its seats by their kind ("4 stools").
- A light's second line leaves out a level at 100 %.
- The start dialog writes sizes with one decimal ("8.0 m"), and "Start empty" is a bordered
  button.
- A reusable set named after its location is named once.
- The lengths of a picked wall and of a picked opening go outside a closed room.
- The PDF legend draws its glyphs without labels, folds identical rows ("Practical ×3") and lists
  the grip standing on its own.
- The power lines fold names.
- A printed glow fades towards its edge.
- The phone's kit sheet keeps its foot covered.
- The phone's Snap toggle is lit when on.
- Board exports draw a plan's card as the board does: the drawing, then the card's name, scene and
  counts.

## Consequences

- Clients of schema 25 open boards of version 26 read-only until they update.
- `UserPreferences` gains five fields; older clients ignore them.
- Existing plans with a scale and a room show its size on the card and in outputs, and are framed
  a little wider to hold it.
- An icon with blocking moves its last position's note to `stepNote` when the board migrates; its
  `note` is then free for the item.
