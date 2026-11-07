# 0078 — Animated tutorials, offered once and kept in step with the interface

## Context

New people did not know what Inkadra is for, where things are, or that a storyboard, a shot list
and a schedule are views of the same data (#502). Long help pages are not read. The tours have to
be short, skippable, shown once on every device, replayable, and they must not rot when the
interface changes.

## Decision

- **What.** A welcome on first sign-in (a modal, a bottom sheet on a phone) that offers a 7-step
  guided tour, and one 3-step tour per feature, offered by a dismissable pill the first time the
  feature is on screen. Each step is a spotlight on the real element, a coach card with a looping
  CSS scene, a 2-4 word title and one line. Settings → Tutorial replays any of them, shows what is
  seen, turns the pills off and starts over. Skipping always says where to find the tour again.
- **Once, everywhere.** Seen tours and the hints switch are two personal preferences
  (`tutorialsSeen`, `tutorialHints`, decision 0055): they follow the account to every device.
  `tutorialsSeen` is an open list of ids, so a client ignores the tours it does not know.
- **Guests** of a link that asks for comments or a decision get a 2-step tour from a pill (the
  first step alone when the link takes only comments), and "?" in the header replays it. They
  have no account, so their seen state is in the browser's local storage; a guest on another
  browser sees the pill once more.
- **Administrators** get the welcome after the instance setup checklist is complete, never on top
  of it. The administration tours are listed for administrators only.
- **Anchors and tests.** Every tour is data in `apps/web/src/tutorial/tours.ts`; a step points at
  `data-tour="<id>"` on the real component. A step whose element is not rendered is skipped (one
  below the fold is scrolled to); a replay far from the feature plays the steps as cards.
  `tours.test.ts` fails when an anchor is no longer in `apps/web/src` or a text is missing, and an
  end-to-end spec walks the welcome, the Storyboard and the guest tours on the real app. AGENTS.md
  asks every interface change to update the tour of the feature it touches.
- **Where the pill goes.** Bottom centre, lifted above the chrome in front (the dock, Draw's tools,
  the presentation strip, the phone's tabs), since the views keep their controls at the top; it
  waits while a toast is in the same place. The spotlight's scrim is a token of its own,
  `--ink-scrim-tour`, darker in the light theme so the lit element stands out.
- **Tests stay quiet.** Browsers driven by automation (`navigator.webdriver`) get no automatic
  offers unless the page sets `inkadra.tutorials = on`, so the other end-to-end specs keep their
  screens.

## Consequences

- Moving, renaming or removing a control means updating its tour; the unit test says which.
- A tour is offered when its first anchor appears, checked about once a second while the person
  has unseen tours and hints on: cheap, but a feature with no element of its own on screen
  (the clipper, the phone app) is only in Settings.
- Spotlight and card move with transforms only, and reduced motion stops every loop.
