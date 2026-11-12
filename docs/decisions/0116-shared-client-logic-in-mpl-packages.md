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
board draws an icon and a shape with, in view units (`placedGlyph` with `glyphStroke` and
`flattenPart`; `planShapeOutline` with `measureText` and `PLAN_TEXT_SIZES`; `beamStrength`),
which the board's SVG and the exports both call. In
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

One behaviour changed with the move, on purpose: the kit, the names on a circuit and the count
across setups went by the translated name, so two kinds a language writes alike (or two specs
that read alike) were one line in that language and two in English. They now go by what the item
is (`KitLine.key`: the kind and its power or length; a named light by its name), and the name is
only written from it: the same plan gives the same lines and totals in every language and on
every client, even when two lines read the same.

Stays in the web: the Kit tab, the view and the card as React; the PDF sheet's layout and
drawing; the clipboard copy of the kit; `measureValue`, `selectionMix` and the seats of the
Properties (editing); the library's search (`library.ts`, editing); reading the schedule and the
project kit from the server (`useScheduleDays`, `useOtherKits`: the derivation of the project kit
was already in canvas-core).

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
- The set plan colours: the set plan is being reworked.
- The rest of a plan's drawing that is not yet in canvas-core: the blocking moves (the board
  draws a quadratic curve with open wings stopped 26 short, exports a polyline with a filled
  head), the position numbers' places, a label's halo and the light's second line under it, the
  ticks of the rooms' sizes, the beam's gradient and the glow's falloff. Move with a plan drawn
  on another client.

Exports and the board draw a plan alike but not the same, and the move kept both as they were:
exports stroke glyphs thinner (their own width rule, dashes in stroke widths), print an arrow's
head filled and shorter, write texts, a zone's name and a measure's length level and in their
own sizes, and leave a measure level. `placedGlyph` and `planShapeOutline` give the board's
drawing; exports take their points and keep their own widths and texts. Making exports match
the board is a change to what they print, for its own PR.

Two things a later move must settle: `referencesOf` sorts by `z` with `localeCompare`, while
canvas-core sorts `z` by code point, and the two can order the same keys differently; and the
storage settings print sizes in steps of 1000 (`formatStorage`) while `formatBytes` uses steps
of 1024, so the same file reads as two different sizes.
