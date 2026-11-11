# 0115 — Product logic shared by clients lives in an MPL package

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

The call sheet model (`castCalls`, `plannedWrap`, `castConflicts`, `dayCrew`, `castKeysOf`,
`byDepartment`, `dialNumber`) is in `packages/shared`, with `commentParts` and `formatBytes`;
`referenceGroups`, `normaliseTag`, `isDrawn`, `estimateHeight`, `FAR_ZOOM` and the image crop
geometry are in `packages/canvas-core`; the card measures are `card` in `@inkadra/ui/tokens`,
and `@inkadra/ui/oklab` exposes the colour maths. The web stylesheet still writes the card
measures as numbers: a web test fails when one differs from the package
(shortcut: reading them from CSS variables, as 0108 does for the shell, would touch many rules;
do it when the board stylesheet is next reworked). The web modules re-export the moved names,
so their callers and tests did not change. Set plan colours stay in the web until the set plan
rework settles.
