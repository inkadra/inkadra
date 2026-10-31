# 0049 · Floating desktop shell

Accepted, 2026-10 (#333). Replaces the fixed header bar and sidebar column on desktop and tablet.

**Context.** The board is the product, but on desktop the fixed top bar and sidebar column took
a 48 px band and a 240 px column away from it, and the board sat in a rounded inset panel. The
approved mockup puts the chrome in floating panels over a board that runs edge to edge.

**Decision.**
- From 768 px up the page fills the window. The navigation is a floating panel (12 px inset,
  236 px wide); the header is two floating panels: where am I (project, view tabs, ⋯) at the
  left, people and actions (Versions, Export, Present, Comments, Share, notifications) at the
  right. A board's canvas view runs under all of them; every other page sits in a rounded
  surface beside them. Phones keep the 0.6.1 layout unchanged.
- Panels share one surface: `--ink-radius-lg`, `--ink-shadow-menu` plus a hairline, and a
  translucent background with a backdrop blur drawn on a `::before` layer (so a panel never
  becomes the containing block of its fixed popovers). The blur is dropped while the board
  moves, so a pan never re-blurs the backdrop every frame.
- The shell publishes `--ink-board-left` (the left edge of the free part of the board): the
  minimap, zoom, Unsorted and tool bar keep to it. The tool bar is centred on that area and
  shifts right rather than touching the minimap corner. Fitting the view leaves out what the
  panels cover.
- Collapsing leaves a logo button; the panel returns on click, ⌘\ or a peek from the left edge.
  The choice is stored per person on the device.
- Pages give the header two parts (`useHeaderContent({ start, end })`); the shell appends the
  bell to `end`.

**Consequences.** Canvas chrome must not assume the canvas starts beside the navigation: use
`--ink-board-left` (0 outside the shell, in surfaces and on phones). Keyboard order and
landmarks are unchanged: navigation, then the header banner, then the page.
