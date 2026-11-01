# Notes for coding agents

Read CONTRIBUTING.md first. These rules are about how much code to write.

## The smallest complete change

Solve the whole task with the least new code. Adapted from Ponytail
(https://github.com/DietrichGebert/ponytail, MIT).

Before writing, read the task and the code it touches. List every place the change must reach:
callers, tests, fixtures, config, exports. That is the scope; extra features are not.

Take the first option that fully works:

1. Does it need to exist? Skip options and flexibility nobody asked for, and name them in one line.
2. Is it already in this codebase? Use the existing helper, component or pattern the way the
   surrounding code does. A `packages/ui` component beats a native widget, and a native widget
   beats a new one.
3. Does the standard library or the platform do it? Use that.
4. Does an installed dependency do it? Use it. Never add a dependency for a few lines.
5. Otherwise write the minimum code that works.

- Finish every part the task needs, including the callers, tests and fixtures the change breaks.
- Don't add abstractions, wrappers, options, config or code "for later". Deleting beats adding.
  Keep the structure the codebase already has.
- Bug fix: grep every caller first, then fix the root cause once, in the shared code.
- Code you move keeps its validation and error handling.
- New logic (a branch, a loop, a parser, money or security) leaves one small test.
- A shortcut with a known limit gets a comment: `shortcut: <the limit>, <when to upgrade>`.
- Never cut: validation at trust boundaries, error handling that prevents data loss,
  security, accessibility, anything the task asked for.
- Inkadra's design rules still apply: tokens from `packages/ui` (radius.test.ts enforces radii),
  existing components, and screenshots for every UI change.
- An approved mockup is part of the task: the smallest change still matches it. If a part of it
  can't be built, ask; don't swap in a simpler widget or drop it on your own.
- Wait for builds, tests and CI without ending your turn: nothing wakes you up afterwards.

## Bugs: find the cause before the fix

Reproduce the bug first (a failing test or a recorded step), find the root cause, fix it once in
the shared code, and keep the test. Don't patch symptoms in each caller. If you can't reproduce
it, say so instead of guessing.

## Before you say "done"

Adapted from Superpowers (https://github.com/obra/superpowers, MIT): evidence over claims.

1. **Spec check, then quality.** Re-read the issue and the approved mockup and go through them
   point by point: every point is done, or listed as skipped with the reason. Only then polish.
2. **Verify, don't assume.** Run the checks that prove it (tests, e2e, CI green on the pushed
   head) and quote the result. A draft, a partial PR or "CI still running" is not done.

## UI review before screenshots

Inspired by Impeccable's "normalize" (https://github.com/pbakaus/impeccable, Apache-2.0) and
design.how's "ui-review" (https://github.com/arla6ka/design.how, MIT). Before you send
screenshots of a UI change, check and fix:

1. **Mockup:** layout, copy, sizes and states match the approved mockup; list any deviation.
2. **System:** only `packages/ui` components and tokens (radii, colours, spacing, motion); no
   one-off styles that a token covers; animations use transform/opacity and respect reduced motion.
3. **States:** light and dark, desktop and phone, plus empty, loading, error, disabled, hover and
   keyboard focus. Take screenshots without a leftover hover or pressed state.
4. **Overlap and fit:** nothing covers neighbouring cards or the floating shell; long text and
   long names don't break the layout at 1280px or on a 390px phone.
5. **Accessibility:** contrast (WCAG AA), labels and roles on controls, full keyboard use, focus
   visible, no duplicate accessible names.

End your report with one or two lines: what you skipped or didn't check, and any risk.
