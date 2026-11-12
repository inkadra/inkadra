# 0121 · Board types: a board shows the views of its type, a project has one Production board

Proposed, 2026-11. The direction was chosen on 2026-11-12 from two interactive mockups; the final
mockup (light and dark, desktop and phone) is the reference once approved. Builds on 0012
(storyboards), 0022 and 0089 (shooting schedule), 0067 (no templates) and 0091 (Troupe).

## Context

A board's kind is `board` or `storyboard`, and it only chooses the view a board opens on. The
rest is navigation built around one storyboard per project:

- `storyboardOf` takes the first storyboard, and "Add storyboard" opens it when it exists, so a
  project cannot have two;
- Storyboard, Shot list, Schedule and Troupe appear together as soon as the project has a
  storyboard, in the sidebar and in the header of every board;
- every ordinary board offers the Moodboard tab, used or not;
- on the canvas a sub-board is a card with an icon, a name and a count, whatever it holds.

People want to add what they need to an empty project, one piece at a time: a second storyboard
for the teaser, a moodboard only where there are references, the schedule only when the shoot is
planned.

## Decision

**A type is the set of views a board has.** Four types, chosen when the board is created:

| Type       | Always                 | Can be turned on     |
| ---------- | ---------------------- | -------------------- |
| Board      | Board (canvas)         | Moodboard            |
| Moodboard  | Moodboard              | none                 |
| Storyboard | Storyboard             | Shot list, Review    |
| Production | Schedule, Troupe       | none                 |

The project's root board is a Board. A board turns on only the views of its type, from "Views" in
the board's ⋯ menu; a view that is off leaves the header, the sidebar and the card, and its data
stays. Changing the type of a board ("Convert to…") is a later decision.

**Several storyboards per project.** Nothing in the navigation assumes one. Review stays per
storyboard, with its own guest link.

**One Production board per project.** It holds the schedule and the Troupe. Its calendar takes
frames and scenes from every storyboard of the project, and a block shows the storyboard it comes
from. "Add → Production" is offered while the project has none. A project without a Production
board shows neither Schedule nor Troupe; the crew rows are kept.

**The header shows the views of the open board, nothing else.** A board with one view shows its
name and the ⋯ menu, without tabs. The phone's view picker lists the same views.

**The sidebar is a tree.** Each board is a row with the icon of its type; a board with more than
one view lists them under it.

**The card of a sub-board previews it.** One card per board, with the preview of one of its
views and small tabs to look at the others. Opening the card opens that view. Several cards of
one board, one per view, can come later on the same card.

## Existing projects

- A storyboard keeps Shot list and Review on.
- A project whose storyboard has shooting days or whose crew is not empty gets a Production
  board; its days move there, still pointing at the same scenes and frames.
- An ordinary board that holds images, links or colours keeps Moodboard on; the others start
  with it off.
- Frames on an ordinary board no longer bring the film views to the project.

## Consequences

- `BoardKind` gains `moodboard` and `production`; a board stores the optional views that are on.
  At most one production board per project is enforced in the database.
- Shooting days belong to the production board and reference scenes and frames of other boards.
  Today a day knows only the scenes of its own board (0022): this is the largest part, with its
  own design for moved, deleted and restored storyboards, archives and guest documents.
- `views.ts` loses the project-wide film links; the sidebar, the header and the phone picker read
  one rule: the views of the open board.
- The tours of the storyboard, the schedule, the Troupe and the moodboard change (0078).
- Delivered in three steps: types, views, header, tree and several storyboards; the card with a
  preview; the Production board.
