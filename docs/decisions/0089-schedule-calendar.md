# 0089 — The shooting schedule as a calendar, saved on its own

Status: accepted. Builds on [0022](0022-shooting-schedule.md); the data and the API do not change.

## Context

The schedule showed each shooting day as a column of cards with a side inspector and a
**Save day** button. Planning a day meant reading clock times off the cards, moving blocks with
"up" and "down" buttons and remembering to save. People plan shoots on calendars: they wanted to
see the hours, drag blocks to a time, stretch them, and not lose work because a button was not
pressed.

## Decision

**A calendar with a Day and a Week view.** Week has a column per calendar date, Monday to Friday,
plus Saturday or Sunday only when something is shot on them; a date without shooting shows
"No shooting". Day shows one date with the day panel beside it. "Today", arrows and the title of
the period move through time; a month in the queue marks the shooting days. The grid is one pixel
per minute and runs from midnight to the end of the latest night shoot on screen; it opens on the
earliest call. Before the call and after the wrap the column is dimmed, and lines mark the call,
the wrap and the current hour. A day that goes on below what is visible says so ("↓ 5 blocks,
until 00:20 (+1)"). Several shooting days on one date get a column each. Phones show one day,
chosen from a row of dates, with the day panel and the queue in sheets.

**Blocks always queue up.** A block without a start follows the one before it (as in 0022), so
there is no "queue" switch:

- dragging a block puts it in the order where its top lands (before the first block whose middle
  is lower); the blocks after it move down, and the block queues up again even if it had a fixed
  time;
- **Alt** while dragging (or **Fixed time** in the editor) gives it an explicit start at the
  minute it lands, snapped to the call when it is earlier. It shows a pin and stays put when
  blocks before it change; the free time before it is drawn as "1h 30 free". If it overlaps the
  previous block the two are drawn side by side, as overlapping blocks are in a calendar, and a
  cast overlap is flagged as before;
- the bottom edge resizes in 5-minute steps (Shift: 1 minute), within the schema's 1–1440;
- dropping on another day moves the block there: the day it leaves closes the gap by itself, and
  one undo restores both days;
- a shot dragged from the queue goes to the time it is dropped on; a click still adds it at the
  end of the selected day.

Every gesture has keys: arrows move between blocks, Alt+↑/↓ reorder, Alt+←/→ move to the
previous or next shooting day, Shift+↑/↓ change the length, Enter opens the editor, Ctrl+D
duplicates and Delete removes (asking first when the block has a title or a shot, as before).
Each change is announced to screen readers. Touch picks a block up after a long press. Creating a
block by dragging on empty time and moving a whole day by its heading are left for later.

**Saved on its own, with undo.** Every edit becomes a draft of its day, as before, and is saved
600 ms after the last change with the revision it started from. The bar says "Saving…",
"Saved at 10:21", "Not saved" or "Needs a decision". Ctrl+Z and Ctrl+Shift+Z (or the buttons)
walk a history of up to 200 steps kept for the session; typing in one field within 1.5 s is one
step. Undo writes the earlier version as a new draft, which is saved like any edit, so it also
works after saving. The 409 handling of 0022 stays: a stale draft is never saved over the other
version; the day is marked and the person chooses "See their version" or "Keep mine". A failed
save keeps the draft, retries every five seconds and when the browser is back online, offers
"Retry now" and "Discard changes", and the tab asks before closing while anything is unsaved. A
move between two days saves the two days separately: if one of them fails, its draft stays and is
retried, so the block can be on both days on the server for a while but is never lost.

**Sunrise and sunset on the device.** When the location text of a day contains a map link
(Google, Apple Maps or OpenStreetMap, read by `parseMapLink` of 0053 without the network), the
browser works out sunrise and sunset with the standard sunrise equation (`sun.ts`). They appear in
the day heading, as dashed lines in the grid (labelled in the Day view), in the day panel with the
note that they are worked out on the device, and in the phone's summary of the day. Without a
link there is nothing but a hint in the panel. The device's time zone stands for the location's,
since days carry none; a location in another time zone would need one stored on the day.

**The day panel** has tabs, built from a list so another can be added in one place: Day (date,
call, planned wrap, location, notes, delete), Block (the full editor) and To bring (0058).

## Consequences

- No contract, database or document change. Explicit starts, durations and order were already in
  the day aggregate.
- More PUT requests than with a Save button: one per day every pause in editing. Each is the same
  bounded aggregate as before.
- The undo history lives in the open tab only; reloading starts a new one.
- Sunrise and sunset are about a minute off at mid latitudes and wrong when the location is in
  another time zone than the device; they are a planning aid, not an almanac.
