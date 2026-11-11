# 0108 — Shell sizes come from tokens.layout

Status: accepted. Amends [0006](0006-design-tokens.md).

## Context

0006 describes the desktop shell as a 52 px icon rail, a 210 px sidebar and a 48 px header,
and `tokens.layout` held those numbers. Since the floating shell (#333) the web app draws a
236 px navigation panel, a 42 px launcher and 42 px header panels, 12 px from the window and
from each other, with the sizes written straight into `styles.css`. Nothing read
`tokens.layout`.

## Decision

`tokens.layout` holds the sizes that ship: navigation 236, launcher 42, header 42, gap 12,
the optional icon rail 52 and the canvas dot grid 22 (canvas-core's `GRID`). `tokens.css`
exposes them as `--ink-sidebar-width`, `--ink-launcher-size`, `--ink-header-height`,
`--ink-float-gap`, `--ink-rail-width` and `--ink-canvas-grid`; the shell and the panels placed
under its header read those variables. A test fails if `styles.css` sets any of them itself.

## Consequences

No visual change. Changing a shell size means editing `tokens.ts` and regenerating
`tokens.css`. The unused 300 px inspector size is gone.
