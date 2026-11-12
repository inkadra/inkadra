# 0116 — Product logic shared by clients lives in an MPL package

Status: accepted. Extends [0008](0008-licences-per-component.md).

## Context

The web app is AGPL-3.0; the mobile app and the packages are MPL-2.0, and an MPL component
never imports from an AGPL app (0008). Some rules both clients must apply alike existed only
inside `apps/web`: who is called on a shooting day and when, the moodboard groups, how a comment
body splits into mentions, the height of a card before it is measured, the card measures of
the board stylesheet. A client that needs them could only write them again, and a copy that
follows AGPL code is not MPL code.

## Decision

Product logic shared by clients (the same input must give the same result on every client)
lives once, in an MPL-2.0 package, as pure functions on the shared types: domain rules in
`packages/shared`, card geometry and board rules in `packages/canvas-core`, measures and
tokens in `packages/ui`. The web app imports it from there like every other client. A client
never copies or ports such logic from an AGPL app: it moves it into a package first, written by
someone who can license it under the MPL, then imports it. Presentation that belongs to one
client stays in that client.

## Consequences

These moved: in `packages/shared`, the rules of the call sheet that say who is called and when
(`castCalls`, `plannedWrap`, `castConflicts`, `dayCrew` with `castKeysOf`, `byDepartment`,
`dialNumber`), `commentParts` and `formatBytes`; in `packages/canvas-core`, `referenceGroups`,
`normaliseTag`, `isDrawn`, `estimateHeight`, `FAR_ZOOM` and the image crop geometry; in
`packages/ui`, the card measures as `card` in `@inkadra/ui/tokens`, and `@inkadra/ui/oklab`
exposes the colour maths. The web modules re-export the moved names, so their callers and tests
did not change.

For the mobile app to read a set plan as the web does, these moved too. In
`packages/canvas-core`: the kit (`kitList`, `KIT_GROUPS`, `planCounts`, `foldNames`,
`setupKit`, `familyKitCount`), the power per circuit as text (`powerLines`, `powerText`); the
rows of the Elements tab and the legend (`foldIcons`, `elementSections`, `itemName`,
`itemSummary`, `supportText`, and `planLegend`, `legendRow`, `legendLine`, `legendValue`, which
were written inline in the read-only view and the PDF sheet); the card and the setups
(`planTitle`, `planCardWords`, `scenesOfPlan`, `setupName`, `setupChanges`, `shotSetups`,
`groupBySetup`, `dayBySetup`); the room's size (`roomSizeText`, `roomSize`); the geometry the
board draws an icon and a shape with, in view units (`placedGlyph` with `glyphStroke`,
`glyphStrokeFactor`; `planShapeOutline` with `measureText`, which takes the app's language as the
rooms' sizes do, and
`PLAN_TEXT_SIZES`), the beam's opacities (`beamStrength`, `beamOpacity`) and the order of a plan's
layers (`PLAN_DRAW_ORDER`), which the board's SVG and the exports both call. In
`packages/shared`: the sun (`sunPosition`, `sunBearingByClock`, `sunTimes`, `locationCoords`,
`sunDays`, `northWay`, `sunRotation`, and `sunFrom`, `sunHeight`, `sunDate`, taken out of the
web's sun section).

Functions that write words take `t` as a `Words` function, i18next's shape, and ask for the
web's keys. The English words they ask for, with the names, search words, tiles, groups and
categories of the icons, are `PLAN_WORDS_EN` in canvas-core, keyed as the web catalogues
(`board.plan.*`); a web test fails when `en.json` says otherwise, and the package's tests read
their words from it, so a missing or misspelt key fails there. The same keys in the other five
languages are `PLAN_WORDS_IT`, `PLAN_WORDS_ES`, `PLAN_WORDS_DE`, `PLAN_WORDS_FR` and
`PLAN_WORDS_PT`, one file each, imported by path (`@inkadra/canvas-core/plan-words/it`) and not
through the package's index, so a client bundles only the languages it ships and the server none.
The web catalogues stay the source the web shows: a web test fails when one of them and the
package disagree, and a package test fails when a language lacks a key English has or fills in
other placeholders. All of these words were written by the project; before a word moves into the
package, its author must be one who can license it under the MPL.

For the mobile app to edit a set plan as the web does, the editing operations of the plan
editor moved out of the web's `usePlanEditing` hook into `packages/canvas-core`
(`plan-editing.ts`), as functions over the plan, its base and the items to write: `planEdit`
(the plan as drawn and written, a setup with its base's Set), `planItemOwner` and
`planLayerOwner` (the Set layer is the base's), `writePlanItems` (locks, then attachments, then
only what changed, each item where it lives), `removeUnlockedItems`, `removeUnlockedWalls`,
`lockWrites`, `rotateWrites`, `nudgeWrites`, `restackWrites`, `moveToPlanLayer` (to Set on a
setup: into the base), `hiddenToggle` (on a setup the document, else this person's preference,
which the client keeps), `lockedLayersToggle`, `ensurePlanScale`, `planIconsFull`,
`freshPlanIcon` and `placePlanIcon` (the icon, its attachment and a project-kit light's
modifiers in one transaction), `planSnapAt` (never to a hidden icon), and from the canvas's
gestures `planDropTarget` (free with snapping off, Alt held, or a kind that never attaches) and
`dropWrites` (pulled off a base: detached; let go on one: attached). Writers take the document
and an origin; the client keeps the undo steps. The new icon's colour is a parameter until the
plan colours move. Stays in the web: the hook's state (tool, armed tile, selection, tabs,
preview, the person's preferences, undo grouping with `change`) and duplicating, which was
already `duplicatePlanItems`.

For the mobile app to name a frame's shot size, angle and movement as the web does, these moved
to `packages/shared`, beside the catalogs in `classifications.ts`: `shotText` (a field's value is
the id of a catalog value, archived too, or text the person typed; an id of a catalog not loaded
reads as nothing), `shotOptionLabel` (a default value is translated until renamed) and
`isRenamedDefault`. Their words are `SHOT_WORDS_EN` (`film.shot.*`, `film.angle.*`,
`film.movement.*`, keyed as the web catalogues), and `SHOT_WORDS_IT`, `_ES`, `_DE`, `_FR`, `_PT`,
one file each imported by path (`@inkadra/shared/shot-words/it`), tested both ways as the set plan
words are. The catalogs' cache, refresh and hooks, and adding a value from where it is used, stay
in the web (`lib/classifications.ts`: state, React and the server's endpoint).

The messages of a project's export and import that the mobile app shows too are
`TRANSFER_WORDS_EN` in `packages/shared` (`transfer.exportLead`, `includedList`, `excludedList`,
`notifyNote`, `exportForbidden`, `startError` and every `transfer.failure.*`, one per
`TRANSFER_FAILURES` code), with `TRANSFER_WORDS_IT`, `_ES`, `_DE`, `_FR`, `_PT` imported by path
(`@inkadra/shared/transfer-words/it`), tested both ways. Titles, buttons and the import dialog's
own sentences stay in the web catalogues until another client imports. Beside `FractionalIndex`,
`comparePosition` is the saved order of siblings (boards under a board, project groups): by
`position` as code units, then by `id`, never by locale.

The notification texts the mobile app shows too are `NOTIFICATION_WORDS_EN` in
`packages/shared`: what every notification type says after the actor's name
(`notifications.type.*`, one per `NotificationType`, a server alert by its kind), the events and
email frequencies of the notification settings (`settingsUi.notifications.events.*`, one per
`NotificationChannelType`; `help.*`, one per `EmailFrequency`; `reviewHelp`) and the sentences of
the private calendar link on a phone (`calendar.helpPhone`, `privacyPhone`, `confirmBody`,
`rotated`, `disabled`), with `NOTIFICATION_WORDS_IT`, `_ES`, `_DE`, `_FR`, `_PT` imported by path
(`@inkadra/shared/notification-words/it`), tested both ways. How a notification is written from
those words (`describeNotification`: the access dates, the alert's sizes, the review status from
`review.status.*`) stays in the web for now: it formats with the web's date and size helpers.

The shooting schedule's empty states, which the mobile app shows too, are `SCHEDULE_WORDS_EN` in
`packages/shared` (`schedule.empty`, `emptyTitle`, `emptyBody`, `emptyReadOnly`, `noBlocks`,
`noMatches`, `allScheduled`, `callSheet.noBlocks`), with `SCHEDULE_WORDS_IT`, `_ES`, `_DE`,
`_FR`, `_PT` imported by path (`@inkadra/shared/schedule-words/it`), tested both ways. The
schedule's editing messages (saving, conflicts, offline) and the sun's notes stay in the web.

One behaviour changed with the move, on purpose: the kit, the names on a circuit and the count
across setups went by the translated name, so two kinds a language writes alike (or two specs
that read alike) were one line in that language and two in English. They now go by what the item
is (`KitLine.key`: the kind and its power or length; a named light by its name), and the name is
only written from it: the same plan gives the same lines and totals in every language and on
every client, even when two lines read the same.

Stays in the web: the Kit tab, the view and the card as React; the PDF sheet's layout and
drawing; the clipboard copy of the kit; the library's search (`library.ts`, editing); reading the schedule and the
project kit from the server (`useScheduleDays`, `useOtherKits`: the derivation of the project kit
was already in canvas-core).

For the mobile app to show a set plan in the web's colours and offer the same Properties
choices, these moved to `packages/canvas-core`. In `plan-draw.ts`, the colours as stored hex
codes with the theme token each is drawn with and the name of its word (`PLAN_COLORS`,
`PlanColor`, `PLAN_INK`, `planToken`), the characters' colours of linked actors
(`CHARACTER_COLOURS`) and the colour a new icon or annotation starts in (`iconColor`,
`NOTE_COLOR`). In `plan-properties.ts`, the presets of a camera's lens and a light's colour
temperature and gel (`LENSES`, `KELVINS`, `KELVIN_RANGE`, `GELS`), how a typed measure is stored
(`measureValue`), what a selection holds by layer (`selectionMix`) and the seats at a table or a
counter (`SEAT_SURFACES`, `NAMED_SEATS`, `seatsAround`, `seatsLine`). The colours' names
(`board.plan.colors.*`) and a selection's words (`board.plan.mix.*`) joined `PLAN_WORDS_EN` and the
other five languages. Stays in the web: turning a token into CSS (`planCss`), the colour
temperature slider's track and thumb (`KELVIN_TRACK`, `kelvinColour`, CSS gradients over the
theme's tokens) and the Properties as React. A gel's preset is its own name in every language
("Plus green"), as it was.

The web stylesheet still writes the card measures as numbers: a web test fails when one differs
from the package (shortcut: reading them from CSS variables, as 0108 does for the shell, would
touch many rules; do it when the board stylesheet is next reworked).

Stays in the web or the server for now; each moves when a second client needs it:

- `withDayCall`: what a change of a person's call stores (only the exceptions to the default).
  Moves before any other client writes day calls, so every client stores the same document.
- `onSetContacts`, `castRows`, `troupeRows`, `personalCall`, `castCard`: how the call sheet
  prints contacts, the cast table, the troupe and the viewer's own call. Move with a call sheet
  on another client.
- `departmentNotes`, `keyTimes`: the department notes and key times of the call sheet. Move with
  a call sheet on another client.
- `referencesOf`: which cards are moodboard references, filtered by tag, and their order. Moves
  with a moodboard on another client.
- `crewCastKeys` (server): repeats `castKeysOf` with the cards read from the boards. Moves when
  the server is changed to read the cards first and call `castKeysOf`.
- The rest of a plan's drawing that is not yet in canvas-core: the blocking moves (the board
  draws a quadratic curve with open wings stopped 26 short, exports a polyline with a filled
  head), the position numbers' places, a label's halo and the light's second line under it, the
  ticks of the rooms' sizes, the beam's gradient and the glow's falloff. Move with a plan drawn
  on another client.

Exports and the board draw a plan alike but not the same, and the move kept both as they were:
exports stroke glyphs thinner (a part without a width of its own at 1 / 1.7 of the board's, one
with its own at `glyphStrokeFactor` / 1.7 of it, dashes in widths of that stroke), print an
arrow's head filled and shorter, write texts, a zone's name and a measure's length level and in
their own sizes (a text's lines from the top of the first, 0.9 of a size above its baseline),
leave a measure level, fill a beam flat where the board shades it, stack four discs for a glow
the board fades, and print the rooms' sizes with the labels, after the numbers. The board writes
a text's lines on one line (SVG folds the breaks). `placedGlyph` and `planShapeOutline` give the
board's drawing, a text's lines each at its own baseline; the board and the exports draw from
them, and a web test holds `placedGlyph`'s widths and dashes to the board's SVG for every kind.
Making exports match the board is a change to what they print, for its own PR.

Two things a later move must settle: `referencesOf` sorts by `z` with `localeCompare`, while
canvas-core sorts `z` by code point, and the two can order the same keys differently; and the
storage settings print sizes in steps of 1000 (`formatStorage`) while `formatBytes` uses steps
of 1024, so the same file reads as two different sizes.
