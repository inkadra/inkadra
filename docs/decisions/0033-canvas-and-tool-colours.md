# 0033 · Canvas types own the content colours; tools get their own; one Canvas menu

Accepted, 2026-10.

**Context.** The board toolbar drew its tools in the content-kind colours (note and to-do
yellow, image, link and colour orange, frame and storyboard purple), so a tool looked like a
canvas type: an orange image button next to the orange Moodboard template. Board and
Storyboard were two separate tool buttons, while Home offered more canvas templates.

**Decision.** The content-kind colours belong to canvas types only: Home templates, board
kind chips, sidebar modules and the Canvas menu (Board neutral, Moodboard orange, Storyboard
purple, Shot list and Film pre-production green, Schedule teal, Review pink). `kind-color.ts`
lists only those.

Canvas tools that create content take `tool-*` tokens from `tool-color.ts`: note amber,
image cerulean, link jade, to-do orchid, colour olive. Column, frame and the navigation tools
stay neutral; the selected tool keeps the accent. The tool hues sit in the gaps between the
canvas hues. Note, image, link and to-do are at least 0.13 OKLab from every canvas colour, the
accent, `accent-soft-fg`, `danger-fg` and `status-danger` in both themes; tool pairs are at
least 0.10 apart and toolbar neighbours 0.12. Icons keep 4.5:1 on `surface-1` and 3:1 on
their tile. In the light theme the tools are darker than the canvas colours (OKLCH L about
0.36 against 0.45–0.55), while to-do and colour sit above them: contrast on white leaves no
other room.

**Exception: colour.** Five coloured tools were chosen over four. A search of OKLCH (chroma at
least 0.07–0.11, hues at least 14° apart) gives five tools at most 0.119 from the canvas
colours in the light theme, against 0.131 dark and 0.133 light for four; the 0.15 first aimed
for is out of reach for any set of distinct hue families. So olive `tool-color` is held to
0.11 instead of 0.13: it is 0.120 from canvas green in the light theme (`#867713`, contrast
4.50:1 on white) and 0.153 from neutral grey in dark (`#8B9E0F`). Light olive is almost the
project-identity yellow, which is not a canvas colour.

**Canvas menu.** Board and Storyboard leave the toolbar for one Canvas button at its end,
after a divider: the bar's primary action, blue (`accent-button`, white text, 5.2:1) with a
plus, the label and a caret; narrow phones drop the label. Its menu opens above the button,
right-aligned to it, and lists a plain board, then every project template that lays out
content (`PROJECT_TEMPLATES` whose setup boards have a seed or a non-plain kind), single
boards first, groups last, each on a tile in its canvas colour, without shortcut hints. An
entry inserts a board card at the viewport centre: the same board the project setup makes
(title, kind), laid out by the same `ProjectSetupSeed`, one connection at a time, from a
queue mounted by the app layout so it continues when the board is opened. A group template
(Film pre-production) becomes a board named after it, holding its boards and their cards. The
B and S keys and the palette's Add board / Add storyboard run the menu's Board and Storyboard
entries.

**Consequences.** S now inserts a laid-out storyboard (one scene, three frames) instead of
an empty one. A board whose layout fails to sync within 15 seconds stays empty and offers its
templates. No API, database or board-document change.
