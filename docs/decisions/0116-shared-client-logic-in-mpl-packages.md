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

Two things a later move must settle: `referencesOf` sorts by `z` with `localeCompare`, while
canvas-core sorts `z` by code point, and the two can order the same keys differently; and the
storage settings print sizes in steps of 1000 (`formatStorage`) while `formatBytes` uses steps
of 1024, so the same file reads as two different sizes.
