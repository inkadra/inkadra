# 0092 — Day calls and the crew on the call sheet

Status: accepted. Last step of the Troupe work, after [0089](0089-schedule-calendar.md),
[0090](0090-call-sheet-at-a-glance.md) and [0091](0091-troupe.md).

## Context

The crew roster (0091) says who works on a project, not who comes on a given day, at what time
and from where. Productions write these exceptions on the call sheet by hand. Spot days also need
a highlighted line under a block ("LIGHTS AND WINDOWS ON") that the block itself could not hold.

## Decision

**Only the exceptions are stored.** A shooting day gains optional `calls`: entries of
`{ crewMemberId, call, pickup, absent? }`, at most 500, one per person, in a new
`shooting_day.calls` JSONB column (migration 0034). By default every crew row is called at the
day's call; a cast row (department or role "Cast", or linked to a character card) is called only
when its name or its character's name is in that day's blocks (`castNameKey`). `absent: true`
leaves a person out, `absent: false` calls them against the default, and a missing `absent`
follows it. `call: null` follows the day's call; `pickup: null` the person's usual pick-up. An
entry that says what the default says is dropped, so the person follows the day again.

**A block note.** `ScheduleBlock` gains an optional `notes` (2000 characters). It is edited in the
block editor (popover, phone sheet, Block tab) and printed under the block's description in the
warning tag colour, on the sheet and in the PDF. Photo or video stays plain text in the title.

**Calls tab.** The day panel's tab list gains "Calls": the computed key times, then the called
crew by department, each with a "called today" checkbox, a call input that shows the day's call
until a time is typed, and a pick-up input that shows the usual pick-up. Cast rows add "On set at
09:00 (12A)" from their first block. People not called are folded under "Not called today". Edits
are drafts of the day: they are saved on their own, undone and resolved on conflict like every
other change of the calendar. Viewers see the tab read-only. Without crew, the tab links to the
Troupe view.

**Call sheet.** After the locations, "Crew and contacts" lists the called crew by department with
role, pick-up, call and phone. The header names the on-set contact (the crew rows marked
`onSetContact`, called ones first). The cast table adds pick-up and call from the day, falling
back to the crew row and the day's call, and keeps "On set". Sunrise and sunset (`sun.ts`)
appear as a key time for the first location with coordinates (a location card's map link, else a
map link in the day's location), labelled with its number; without coordinates there is no cell.
On a phone the crew is a list with a 44 px call button (`tel:`) per person with a number; the
viewer's own row says "(you)" without a button. "Your call" comes from the crew row linked to the
viewer's account, with its own call and pick-up; a viewer who cannot read the roster (a grant on
one board) gets the cast names of their own row from the attendance links instead, and answers
presence through the same row (0091).

## Privacy

Calls, pick-ups, phones and notes are team data (0013, 0083, 0091). The schedule API returns
`calls` only to project members: a grant on one board, and the Home feed, get days without them,
and a call list such people send is ignored. The crew is read from the crew API, which guests and
board-only grants cannot reach. The client export builds no call sheet and its scene sheets get
no days. Project archives keep block notes but not calls, as they do not keep the roster.

## Consequences

- Additive contract. A save without `calls` keeps the stored ones, and a block an older client
  saves without `notes` keeps its note (the server copies it by block id), so open tabs of the
  previous version cannot erase either.
- The server returns `calls: []` to the team for a day saved without them; the calendar reads a
  missing list as empty when it compares drafts, so undo and autosave see no change.
- Character cards on another board of the project are resolved through the project's characters
  (`/crew/characters`), read only when a crew row links a card on another board; the live card of
  the open board wins. The server resolves them the same way for presence.
- Attendance answers follow the crew rows (0091, cast links merged).
- Sunrise and sunset are shown on the project's clock: its IANA time zone (0061), which the web
  app now sets to the creator's device zone when a project is made, "UTC" included. Nothing set
  the zone before, so migration 0036 makes the column nullable and turns the stored default "UTC"
  into "not set": the API leaves the field out (it was already optional), the calendar feed keeps
  reading UTC, and the call sheet uses the device's zone. This is a deliberate trade-off: the old
  default cannot be told from a "UTC" set through the API or an import before 0036, so such a
  project becomes unset too; set it again through the API. There is no per-day or per-location
  zone. **Setting the zone** (follow-up): editors set or clear it in the project's "Type and time
  zone" dialog (Projects page, card menu), a select of the platform's IANA zones whose first choice
  is "Automatic", naming the device zone; `PATCH /projects/{id}` takes `timeZone: null` to clear it
  and still rejects names the runtime does not know. Nothing warns when the zone is unset.
