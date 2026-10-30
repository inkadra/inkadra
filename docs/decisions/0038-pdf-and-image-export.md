# 0038 — PDF and image export in the browser

Status: accepted.

## Context

Teams hand boards, storyboards and shot lists to the set and to clients as PDF or as a single
picture. The image has no headless browser (decision 0002 keeps one image small) and the
web app runs under a strict Content Security Policy: `script-src 'self'`, no inline scripts,
`worker-src 'self'`, no external services.

## Decision

Exports are built **in the browser** from the board document, not by screenshotting the DOM
and not on the server.

- `apps/web/src/board/export/` lays out pages as a short list of drawing operations (boxes,
  lines, wrapped text, pictures, pen strokes) in PDF points. Layout and pagination are pure
  functions with unit tests; text is measured with the same font that is embedded.
- Two backends draw the same pages: **pdf-lib** (MIT) with **@pdf-lib/fontkit** (MIT) writes
  the PDF with vector text and Inter (OFL-1.1, the interface font from `@fontsource/inter`)
  embedded as a subset; the Canvas 2D API draws the PNG and the live preview of the dialog.
  Neither library uses `eval`, `new Function` or workers, so the CSP needs no change. The
  libraries and fonts are loaded with a dynamic `import()` only when the dialog opens.
  pdf-lib brings pako (MIT and Zlib), so Zlib, a permissive licence compatible with the AGPL,
  joins the allowed licences of `scripts/check-licenses.mjs`.
- Cards are redrawn in a print style rather than captured: notes, to-dos, links, files,
  colours, columns, scenes, frames with their drawing, sub-boards and arrows. Heights come
  from the measurements the canvas already keeps, so the page matches the board.
- Pictures use the **WebP thumbnails** (up to 2048 px) fetched from the same origin, never the
  originals: everyone who can open the board may see them, and 2048 px across an A4 page is
  about 250 dpi. They are re-encoded to JPEG for the PDF.
- **Audience.** "For clients" exports exactly what a guest of a share link would see: cards
  hidden from guests and everything inside them are left out, and every element passes
  through `toGuestElement` (no tags, production status or director's notes). It is the
  default, because an export sent to the wrong person cannot be recalled. Comments are off by
  default; with clients only threads visible to everyone are included.
- The export is offered in the board menu (editors, like the rest of that menu), in the menu of a
  selection and in the Storyboard and Shot list views (everyone who can open the board).
- The dialog starts from the project's **shared export settings** and prints the project's logo
  (decision 0039). Editors who export save their choices back as the new starting point; a new
  logo is uploaded as a PNG or JPEG asset of the project.

## Consequences

- No new server dependency, no new endpoint and no CSP change; exports work offline once the
  board and its thumbnails are loaded.
- The page is not pixel-identical to the canvas: rich text keeps paragraphs, headings and
  lists but not inline marks, and embedded videos show their poster or name.
- Text outside the Latin range of the bundled Inter subset (for example CJK) prints as
  missing glyphs until more subsets are embedded.
