# 0071 — A simpler set plan

The set plan editor of decision 0062 had a column of tools, a panel with three tabs and a bar under
the plan. In QA 0.8 it read as confusing, so its interface is now two bars: one of tools at the
bottom and one on the selected item. Icons, layers and scale open only when asked. Variants, scene
links and the data of a plan stay as they were.

- **Size of symbols.** Document version 18 adds an optional `percent` on plan icons, a proportional
  size from 10 to 1000 % of medium, with a no-op migration from version 17. Existing icons keep `S`
  or `L` and are drawn exactly as before; they read as 73 % and 136 % in the bar, and `percent`
  replaces `size` only when someone resizes that icon. As in decision 0068, clients that support
  fewer versions stay read-only on a version 18 document, so they cannot drop the field.
- **A measure written by hand** is a label: a plain number in the `text` the shape already has. The
  drawing does not change. On a plan without a scale the editor offers to make that line the scale.
- **Route.** The Movement tool becomes Percorso, started from the bar of the icon. The editor draws a
  line through numbered points, with the veiled copies behind "Mostra posizioni precedenti". The
  card on the board and the exports keep drawing blocking as they did.
- **After placing an icon** the tool goes back to Select; Shift keeps placing.
- **Who cannot edit** a plan, a guest first, can now open it to look: the drawing and its zoom.
