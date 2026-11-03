# Contextual toolbar A implementation and verification

PR: https://github.com/inkadra/inkadra/pull/411

## Approved scope and stack

The UI branch originally started at reviewed contract commit
`463cf4370f74e2f4d776b51455ce8795b99bb89d` and is now rebased on the review-corrected
contract `1fdf6646c1210a87cd1f97058ad4c5d6553bc757`. Its PR base remains
`contract/contextual-toolbar-a`; the parent retargets after that PR merges. No file in
`packages/doc-schema` is changed by the UI PR; schema-16 note-body declarations and
ADR 0068 were corrected separately in contract PR #410. The binding design is alternative A of
`mockup-v4.html`, with the dock from `mockup-v3.html` in the private
`inkadra-contextual-menus` attachment folder.

## Inventory and implementation checklist

| Area / card             | Implementation                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared selection        | Existing single-click selection actions and multi-selection/read-only filters retained. Editing replaces that same anchored bar; Done, Escape and background return to selection. The anchor is held during editing and constrained to the viewport.                                                                                                                             |
| Shared editing actions  | Common actions stay in the ellipsis, including card tints only for notes/tables/columns. Menu opening retains its editing action set even when a field blurs. Active inline fields commit before unmounting.                                                                                                                                                                     |
| Note                    | Enter, double click and typing enter the inline editor. Text/H1/H2/H3, B/I/U/S, bullet/ordered/task lists, alignment, links, eight text/highlight colors plus neutral, and clear formatting. Formatting requires a text selection; heading changes isolate partial selections, lists/alignment affect touched paragraphs. One grouped popover at a time; Escape closes it first. |
| Image                   | Enter/double click edit; viewer remains in the menu. Grid fit uses the existing 22-unit grid; crop, 90-degree rotation and drawing are exposed. Shared SVG rendering applies crop/rotation to both source image and strokes. Drawing points are source coordinates per ADR 0068.                                                                                                 |
| Image collaboration     | New image creation initializes its shared Y.Array. The collaboration server initializes legacy images once before synchronization. First simultaneous strokes append to the same array rather than replacing it.                                                                                                                                                                 |
| Link                    | Appearance is entered from the menu; double click/Enter still opens the site. Info hides metadata without deleting it.                                                                                                                                                                                                                                                           |
| Embedded video link     | Info and Preview are independent switches; viewer entry remains unchanged. Hiding Preview unmounts the embedded player.                                                                                                                                                                                                                                                          |
| Uploaded video file     | Appearance exposes Preview without entering caption editing. The existing viewer and caption action remain available. Other file families ignore this switch.                                                                                                                                                                                                                    |
| PDF / documents         | Existing page previews/viewer/caption editing retained; no invented specialist tools. Editing bar contains ellipsis and Done.                                                                                                                                                                                                                                                    |
| Audio / voice file      | Existing playback/waveform/viewer/caption editing retained; no new document type.                                                                                                                                                                                                                                                                                                |
| 3D / font / other files | Existing tiles/specimens/previews/viewers retained.                                                                                                                                                                                                                                                                                                                              |
| Todo                    | Existing title/items, assignment and on-card controls retained; common editing actions use ellipsis/Done.                                                                                                                                                                                                                                                                        |
| Table                   | Four direct desktop add/delete row/column commands; grouped row/column controls on phones. Current target uses stable row/column IDs. Deletion is disabled without a valid target and at minimum size; insertion respects limits. Existing header menu and column resizing retained. No column-type enum or menu added.                                                          |
| Section                 | S/M/L, B/I, alignment, eight colors plus neutral and line toggle. New headings are M/bold; omitted legacy appearance remains 20/600. New heading rules have a thick leading segment and thin continuation; long titles fit with ellipsis.                                                                                                                                        |
| Column / scene          | Existing inline title editing/collapse behavior retained. No scene tint or invented typography controls.                                                                                                                                                                                                                                                                         |
| Board link              | Existing open/permission-checked rename/icon behavior retained.                                                                                                                                                                                                                                                                                                                  |
| Frame                   | Existing detail panel and drawing editor retained.                                                                                                                                                                                                                                                                                                                               |
| Character / location    | Existing detail panels and guest field filters retained.                                                                                                                                                                                                                                                                                                                         |
| Color                   | Existing inline label and HEX/RGB copy controls retained.                                                                                                                                                                                                                                                                                                                        |
| Arrow                   | Existing label and line/curve/end controls remain accessible during editing. No comments or guest-visibility action introduced.                                                                                                                                                                                                                                                  |
| Set plan                | Existing dedicated editor, layers, variants and scene actions retained.                                                                                                                                                                                                                                                                                                          |
| Dock                    | Table, Voice, Section, Map and Set Plan join the configurable defaults. Hidden tools remain in Canvas exactly once. Approved tool colors are tokens; Section remains neutral. Icon-only resting surfaces match v3.                                                                                                                                                               |
| Integrations            | IT/EN keys and preferences labels updated. Note fragments retain their formatting in guest reconstruction and JSON/Yjs copying. Image drawings render in board/viewer/guest/moodboard and PDF/PNG exports with the same transform.                                                                                                                                               |

The existing print policy from ADR 0038 is retained: note export keeps block structure
and lists, while inline marks are flattened. Rich text remains lossless in the live
board, guest document and JSON/Yjs export. No dependency was added.

## Verification environment and evidence

All installation, formatting, lint, typecheck, build, unit tests, browser tests and
performance tests ran through `ssh workstation`, in the dedicated checkout
`H:\T3 CODE\inkadra-toolbar-a`. Slot A and unrelated checkouts were not changed.
The disposable PostgreSQL/Valkey services use ports 55411/56411; browser tests use
3411/5411/3412. No homelab or Cloudflare service was modified.

Before evidence was reused from the existing private `inkadra-qa08-polish/before`
attachment folder, rather than rebuilding main. After evidence is in
`~/.t3/userdata/attachments/inkadra-contextual-toolbar-a/after/`: selection, note
typography and colors, section, image drawing, table and link appearance, each at
1280 and 390 pixels in light and dark. A 390x500 viewport additionally checks and
captures popover fitting when vertical space shrinks.

The tests caught and retain regressions for Escape exiting the editor while a color
popover was open, and an outside click dropping an uncommitted column title.

## Actual checks

- Workspace typecheck: 8 packages passed.
- Production build: web/server/clipper passed (existing chunk-size warnings remain).
- Repository lint: passed over 1,028 files, with 48 warnings and 5 informational messages.
- Targeted web and guest tests: 73 passed in 10 files.
- UI tokens, contrast and radius tests: 22 passed in 4 files.
- Canvas core board tests: 13 passed.
- Legacy image drawing initialization on the server: 1 passed.
- Browser scenarios: 4 toolbar/appearance scenarios plus 2 inline-commit regressions,
  passing at desktop and phone widths. The latter first failed on the unpatched UI
  with the original title still visible after an outside click.
- Existing 1,000-element performance gate: passed; warm open 791 ms, pan average
  16.67 ms, pan p95 16.8 ms. This ran before the final inline-blur/menu fix; that fix
  does not run during opening, panning or zooming. The private attachment folder
  includes `perf-results.json`.

UI review inspected the new bar/popovers in both themes at both widths, the
short-height viewport, long section title fitting, selected/disabled states and
focus restoration. Screenshot capture moves the pointer away and disables
animations; the existing motion rules respect reduced motion.

## Independent review corrections

1. **Stale-client data loss:** #410 now declares `noteInk`, `taskList`, `taskItem`, and
   block alignment as persisted schema-16 data in `NOTE_BODY_FORMAT` and ADR 0068.
   The live connection observes document metadata before mounting editors, stays read-only
   for newer schemas and shows an update-app alert. Clients advertise their supported schema
   in the WebSocket query. The server refuses writes for absent/invalid/older versions,
   retains this restriction across role rechecks, and demotes connected clients if the live
   document advances beyond their support. The contract declaration and live observer tests
   failed before; real-WebSocket tests for absent/schema-15 editor clients failed before and
   now pass, including rejected forged writes and permission rechecks.
2. **Quarter turns:** contextual rotation calls the same extracted command as the crop
   editor, including `cropAfterQuarterTurn`, inscribing free angles and resetting explicit
   geometry/refreshing arrows through `applyImageTransform`. The regression compares actual
   crop geometry with the existing crop-editor rule and checks image bounds; presets retain
   the existing crop-editor semantics, rather than introducing unsupported portrait enums.
3. **Restored drawing arrays:** version restore prepares shared image arrays within its
   transaction; collaboration changes also prepare rollout imports. The client recovers a
   missing array lazily without replacing existing ink and reports an append failure through
   a localized toast. Missing-array and pre-v16 restore tests failed before and now pass.
4. **Focus:** leaving an editor only refocuses the canvas if focus is lost or remains in
   the removed editor. Blur to contextual controls/menus keeps edit mode alive. The browser
   regression failed when focusing the ellipsis; it now checks Tab to Done, native
   Enter/Space activation instead of canvas shortcuts, and Search focus while typing N
   without creating a board note. Read-only schema checks preserve the sync handshake.
5. **Section weight:** omitted bold remains legacy 600 and B inactive; the first press
   makes it explicit 700. Explicit false is 400. PDF embedding, browser font loading,
   measurement and PNG rendering now support the real 700 font. Both the toggle and export
   regressions failed before.
6. **Section commit:** the inline field remains local until blur, Enter or Done; the shared
   exit path commits before unmount. A browser test first observed 15 outgoing document
   updates for 15 typed characters; it now requires zero while typing and one on commit.
7. **ARIA shortcut:** empty key hints omit `aria-keyshortcuts` entirely. The voice-recorder
   attribute regression failed before and now passes.

Review validation ran only on the workstation, using a separate `inkadra_review` database
for server integration tests and the existing disposable E2E database for browser tests.
The focused checks pass: 16 schema-contract tests, 78 web tests, 11 restore/drawing server
tests and 17 real-WebSocket collaboration tests. Workspace typecheck and production build
pass. Browser evidence includes `review-schema-{1280,390}-{dark,light}.png`; actual mobile
keyboards are still outside the Chromium viewport verification.

## Limits and review handoff

The user requested CI follow-through for both #410 and #411 after these fixes. Neither
PR is merged by this implementation agent; independent approval remains with the reviewer. Existing dedicated editors and every file
codec were not manually re-exercised. Real iOS/Android keyboard behavior is not
claimed by the resized Chromium viewport check.
