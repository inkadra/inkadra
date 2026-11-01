# 0058 — Needed items rolled up by shooting day

## Context

Scenes need costumes, props and equipment, and on set they have to be gathered by shooting day
(#323). The board already has to-do lists with assignees (decision 0054), scenes on the
storyboard and shooting days whose shot blocks point at the storyboard's frames.

## Decision

Document schema 13 adds two optional fields to the to-do card: `list` (`wardrobe`, `props` or
`equipment`; shown as Costumi, Attrezzeria, Attrezzatura) and `sceneId`, a scene of the same
board. Nothing new is stored on shooting days and there is no database migration.

A day's "Da portare" is computed in the client: the scenes of the frames its shot blocks
reference, then the items of every typed list linked to one of them. Items with the same text
(ignoring case and outer spaces) in the same kind of list merge into one row, "×2", with all
their scenes. There is one checked state, the item's own `done`: ticking a row ticks every
merged item on its card, so the board, every day that shoots the scene and the call sheet agree.
Who brings a row is the first assignee among its items; assigning from the day assigns them all.
The call sheet prints the same rows with empty boxes, to tick by hand.

## Consequences

Links are by element id, so renumbering a scene keeps them; duplicating or pasting a scene with
its lists points the copies at the copied scene. A list on another board (a moodboard) cannot be
linked yet: the schedule only reads its own board. Linking by scene number, as character cards
do, would need the schedule to load other boards' documents; revisit if lists outside the
storyboard turn out to be common. This is not a breakdown tool: there are no quantities,
departments or per-day state beyond the three kinds of list.
