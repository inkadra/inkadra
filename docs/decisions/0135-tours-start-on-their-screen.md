# 0135 — A tour started from Settings opens its screen first

Status: accepted, 2026-11-21. Amends [0078](0078-tutorials.md) ("a replay far from the feature
plays the steps as cards").

## Context

A QA pass on the testing instance reached Done in all 33 tours, but several played from a screen
without their controls, so every step was a card pointing at nothing: Shooting schedule from a
plain board, Client review from Home, Backup on a slow instance (its page waits for
`/instance/backups`, which adds up the size of every file, longer than the 2.5 s the player waited
for an anchor). Shooting schedule started from the Production board had all of its steps on
their controls: the content was right, the start was not.

## Decision

- **Every tour whose steps point at a screen declares it** in `tours.ts`: `href` for a page
  (Home, the settings sections), `start: { view }` for a board view (Canvas, Moodboard,
  Storyboard, Shot list, Schedule, Troupe, Review), `start: {}` for any board (the panels and
  dialogs of a board), `start: 'inbox'` for the Inbox. `tours.test.ts` fails on a tour with an
  anchor and no start, except those of the shell (the demo bar).
- **Settings → Tutorial opens that screen before step 1**: the board on screen when it has the
  view, else the first one of the project on screen (the first project from elsewhere) that has
  it. The tour then waits up to 10 s for its first anchored step.
- **What is missing is said in one line, never played as cards**: a project without a storyboard,
  moodboard or Production board offers Create to its editors; a view that is off, a panel to
  open, or nothing on the screen yet gives the tour's own line (`tutorial.tours.<id>.where`); no
  project offers New project. The line stays in the settings window, where the tour was asked
  for.
- Tours of a module that is off are not in the catalogue (0121), so none of them needs a "Turn
  on" of its own. The panels a tour describes (Comments, Share, Versions, Export, Present, Draw,
  the set plan, a character card, a video card) are not opened by the tour: the person opens
  them, and the tour says how.

## Consequences

- A tour without a start keeps 0078's behaviour: it plays on the page underneath, as cards when
  none of its anchors is there (the clipper and the phone have none).
- A new tour needs a start, and a board tour a `where` line in every catalogue.
