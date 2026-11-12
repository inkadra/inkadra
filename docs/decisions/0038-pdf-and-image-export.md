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
  the PDF with vector text and Inter (OFL-1.1, the interface font) embedded as a subset; the
  Canvas 2D API draws the PNG and the live preview of the dialog.
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
- Text in a script Inter does not have (for example CJK) prints as missing glyphs.

## Update 2026-11-12: Latin Extended and Cyrillic

The PDF used Inter's Latin subset alone, so Polish, Czech, Turkish or Russian text printed as
missing glyphs. Exports now read Inter as Google Fonts' whole static files, one per weight
(400, 500, 600, 700), from `@expo-google-fonts/inter` (exact version; the fonts are OFL-1.1, the
package's few lines of JavaScript MIT). Each file has Latin, Latin Extended, Cyrillic, Greek and
Vietnamese, so the page model keeps one font per weight and pdf-lib still embeds only the glyphs
a page uses. They are the same Inter build as `@fontsource/inter`'s subsets, so Latin text
measures and wraps exactly as before.

- TrueType, not WOFF2: fontkit reads WOFF2 but cannot subset it. The four files are about
  335 KB each instead of 31 KB (about +1.25 MB in all), fetched only when an export is made and
  not kept by the service worker (`.ttf`); a PDF's embedded subsets grow only by the glyphs it
  uses.
- Google Fonts' TTFs leave some glyphs at an odd length. fontkit gives a small subset the short
  `loca` table, which stores each offset divided by two, so an odd length truncated every later
  offset and most letters printed blank. `patches/@pdf-lib__fontkit@1.1.1.patch` (pnpm
  `patchedDependencies` in `pnpm-workspace.yaml`) pads such a glyph by one byte; `pdf.test.ts` in
  `@inkadra/print` decodes the embedded glyphs and fails without it. Upgrading fontkit means
  checking whether the fix is still needed before dropping the patch.
- `@inkadra/print` measures and writes with these files, so a sheet made on the server from the
  same files stays identical to the web's.
- No CJK: Inter has none, and a second font per text would change the page model.
