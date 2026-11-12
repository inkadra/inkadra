# 0121 · Board types, personal modules and a shorter toolbar

Accepted, 2026-11-12. The maintainer approved the interactive mockups kept in
[0121/](0121/): `board-types.html` (types, header, tree, cards, Production),
`modules-settings.html` (the Modules page) and `toolbar-and-hints.html` (the toolbar, the Canvas
menu and hints, direction B with one short notice). They are the reference for layout and copy. Builds on 0012
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

## Modules

**A module is a part of Inkadra a person can turn off for themselves.** Settings → Modules, in
the personal settings, saved with the account's preferences (0055). Five modules, all on by
default; Board (notes, images, links, files, to-dos, columns, comments) is always on.

| Module         | What it owns                                                              |
| -------------- | ------------------------------------------------------------------------- |
| Storyboard     | Storyboard boards, Shot list, the Frame tool, screenplay import to scenes |
| Production     | The Production board: Schedule, Troupe, call sheets, scene sheets         |
| Moodboard      | Moodboard boards and the Moodboard view of a board                        |
| Client review  | Guest review links, approvals and change requests                         |
| Set plan       | The set plan tool and card                                                |

- **Off hides the ways to create, never the data.** Menu entries, tools, settings sections, tours
  and notifications of the module disappear for that person. Content that exists stays visible
  and opens: a colleague's Production board shows a thin line under its title, "Production module
  off: you can read this board", with Turn on. Nothing is deleted, and turning the module on
  again brings everything back.
- **Personal only.** The server does not refuse anything because of a module; an instance-wide
  switch is a later decision.
- **One registry.** A module lists its board types, views, tools, menu entries, settings
  sections, tours, notification kinds and export contents, and every surface reads that list.
  A new feature that belongs to a module is added to the registry, not to each surface.
- **Few and coarse.** No switch inside a module (call sheets apart from the schedule).

## Hints for modules that are off

- **In the menus (the rule).** In the Canvas menu a board type of a module that is off stays,
  dimmed, with Turn on; choosing it turns the module on. No message appears elsewhere.
- **One short notice.** After a screenplay import with Storyboard off, the scenes arrive on the
  board as cards and one line above the toolbar says what Storyboard would do, with Turn on. It
  shows once per module and leaves by itself, like the undo notices (0052). "Import a
  screenplay" stays in the Canvas menu, dimmed like the types.
- No cards that wait for an answer, and no hint for a module that is on.

## The toolbar

- **Always in the bar:** Select, Hand, Arrow; Note, Image, Link, To-do; More; Canvas. They cannot
  be removed.
- **More (⋯)** lists the other tools (Column, Section title, Colour, Table, Voice note, Map, and
  the tools of the modules that are on: Frame, Set plan), each with "Put in the bar". Column and
  Section title start in the bar. The saved bar of 0055 is kept: a tool a person had shown stays.
- **Canvas** holds only boards to create, one card per type with a small preview, and the
  screenplay import. Hidden tools no longer live there.
- Tools keep their colours (`tool-color.ts`); the bar starts with 11 buttons instead of 16.

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
- Delivered in four steps: types, views, header, tree and several storyboards; modules, the
  Modules page, the toolbar, the Canvas menu and hints; the card with a preview; the Production
  board.
