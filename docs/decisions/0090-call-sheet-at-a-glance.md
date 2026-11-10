# 0090 — Call sheet at a glance

## Context

The approved Troupe mockup puts the day's useful information on the call sheet itself.
This is step 1 of the Troupe work: print changes using existing board data only.

## Decision

Derive call, first shot, first break, camera wrap and crew wrap from the existing schedule
with its overnight offsets. Omit unavailable times. Solar times follow the calendar work.
Resolve numbered locations in shooting order, matching story-bible cards by trimmed,
case-insensitive name. Use the day's free-text location when scenes supply none.

Put each shot's own frame in its schedule row. Remove the separate frame section and
its switch; keep set plans. Show scene-needed items on that scene's first row, by scene
identity even without numbers. Omit the scene column on unnumbered days. Break and move
rows use semantic green and orange tokens. Cast shows actor, contact and first appearance
labelled “In scena”. The PDF uses the same pure derivation helpers.

The schedule passes its existing store through one optional prop. Document elements are
read inside the sheet; no contracts, schemas, migrations or server behavior change.
Guest document filtering and team-only PDF gating remain the privacy boundaries. Contacts,
call times and internal notes must never be added to guest or client output.

## Consequences

No crew list, on-set contact, pick-up, personal crew calls or new saved fields are introduced.
These belong to the later Troupe step. Existing linked-cast attendance remains unchanged.
