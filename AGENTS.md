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
- Dates always use `DateField` from `packages/ui` (its own calendar), never a native date input
  or picker; `date-input.test.ts` enforces it.
- An approved mockup is part of the task: the smallest change still matches it. If a part of it
  can't be built, ask; don't swap in a simpler widget or drop it on your own.
- Wait for builds, tests and CI without ending your turn: nothing wakes you up afterwards.

## Every feature belongs to a module

Inkadra is modular (decision 0121): a person can turn off Storyboard, Production, Moodboard,
Client review and Set plan in Settings → Modules. A new feature that fits a module is added to
the module registry, so its menu entries, tools, settings sections, tours, notifications and
export contents follow the switch; a feature that fits none either belongs to Board (always on)
or needs a decision for a new module. Off hides the ways to create, never existing data. Where
an off module would change the result of what the person just did, say so once, with Turn on.

## Changes that reach the mobile app

The mobile app (MPL-2.0, currently Android) uses `packages/*` through a pinned revision of
this repository and talks to the server's `/api/v1`. It never copies code from `apps/web` or
`apps/server` (decisions 0008, 0116). Changes confined to `apps/web` or `apps/server` alone
do not reach it. These do:

1. **`packages/*`** (`canvas-core`, `doc-schema`, `print`, `shared`, `ui`): any exported name
   added, renamed or removed, and any change of behaviour, types or shared word catalogues.
2. **Server API**: stay compatible with installed app versions. Gate new behaviour behind
   a capability in `GET /api/v1/instance/version` (decisions 0120, 0122); keep changes additive
   within v1. Never remove or rename fields, error codes or endpoints without a new version or
   deprecation period (see CONTRIBUTING.md).
3. **Board document schema**: follow CONTRIBUTING.md and decision 0102. Every schema change
   bumps `CURRENT_SCHEMA_VERSION` in `packages/doc-schema` with a migration. Lowering `min` in
   `WRITER_SCHEMAS` requires a proof test in `canvas-core` that older writers lose nothing;
   keep unknown fields and preserve the strict per-card check.
4. **Logic moved from `apps/web` into a package** (decision 0116): move shared product logic
   into an MPL package first so the mobile app imports it rather than duplicating AGPL code.

When your change touches any of these, end your PR report with one line for the maintainers:
`#<PR> merged: <sha>. <what changed> — for the app: <nothing | what to adapt>`, and write
**BREAKING** when existing callers must change.

## Keep the tutorials up to date

Any change that adds, moves, renames or removes interface must update the tour of that feature in
`apps/web/src/tutorial/` (`tours.ts`: steps, `data-tour` anchors, texts in every catalogue, media).
A new feature gets its own tour. `tutorial/tours.test.ts` is the safety net: it fails when an
anchor is gone or a text is missing. See decision 0078.

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

Screenshots of a pull request are never committed and never put in its description or in a
branch: the repository is public. Save them outside the checkout (or in a folder Git ignores) and
show them to the maintainer privately; the pull request says at most "screenshots shared
privately". `docs/screenshots/` holds documentation images with demo data only, added when the
documentation uses them.

End your report with one or two lines: what you skipped or didn't check, and any risk.
