# 0006 · Design tokens, Inter, dark first

Accepted, 2026-10.

**Context.** The interface follows a private design reference: near-monochrome, airy, dark
by default with a light theme, colour only where it means something.

**Decision.** `packages/ui/src/tokens.ts` holds every colour, spacing, radius, layout size and
duration; `tokens.css` is generated from it as `--ink-*` custom properties for both themes.
The typeface is Inter (400, 500, 600; never 700), self-hosted through `@fontsource/inter`, with
the system monospace for technical data. Blue `#3B7CF6` marks selection and focus; filled
buttons use `#2563EB` so white text keeps 4.5:1 contrast. The desktop shell is a 52 px icon
rail, a 210 px sidebar, a 48 px header and a rounded main panel. The theme follows the system
until the user picks one.

**Consequences.** Components never use raw colours. A test checks that both themes define the
same tokens and that key text and button pairs meet contrast targets.
