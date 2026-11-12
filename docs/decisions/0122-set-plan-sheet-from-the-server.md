# 0122 — The set plan sheet as a PDF from the server

Status: accepted (owner decisions of 2026-11-12). Extends [0038](0038-pdf-and-image-export.md)
(the server now also writes a PDF, with the same package and no headless browser),
[0111](0111-set-plan-links-and-outputs.md) (what guests see of a plan) and
[0116](0116-shared-client-logic-in-mpl-packages.md) (the server imports the sheet's layout and
words from the MPL packages). This record is the contract; the routes, limits and parity tests
come in the next pull request.

## Context

The web app lays the set plan sheet out with `@inkadra/print` and writes it with pdf-lib in the
browser (0038). The mobile app cannot run that pipeline as it is: it has no canvas for pictures,
no fontkit patch and no copy of the fonts. Writing it again on the phone would be a second
implementation to keep equal. The server can run the same MPL code on the stored document.

## Decision

**Routes.** Two reads, `GET` with no body, a plain download URL and an `ETag`:

- members: `GET /api/v1/boards/{boardId}/plans/{planId}/sheet`, query `PlanSheetQuery`;
- guests: `GET /api/v1/guest/links/{linkId}/boards/{boardId}/plans/{planId}/sheet`, query
  `GuestPlanSheetQuery`, with the guest cookie as the other guest reads.

**Query** (`packages/shared/src/plan-sheet.ts`). Unknown parameters are refused with 400, so an
option added later is never silently ignored by an older server.

- `setups`: `this` (only this plan) or `all` (default: its family, base first, as the web
  dialog). At most 20 setups per sheet; a larger family answers 400.
- `include`: comma list of `legend`, `kit`, `power`, `notes`, `scale`, `background`,
  `dateScene`, `grid`, read as a set; an unknown name is 400, an empty value prints none of
  them. Absent: the parts saved on the plan (`sheetInclude` of the base plan), as the dialog
  opens with.
- `lang`: one of the six app languages, `en`, `it`, `es`, `de`, `fr`, `pt`. Absent: the
  account's language (`users.locale`) when it is one of them, then the first of them in
  `Accept-Language`, then `en`. Guests have no account and start from `Accept-Language`.
- `audience`, members only: `team` (default) or `client`. The guest schema has no such field
  and refuses it: guests always get the client copy.

Not in v1, each additive later: an area of the plan (`area=x,y,w,h`, the dialog's "what is on
screen"), paper size and orientation (the sheet is A4 landscape) and PNG or JPEG.

**What is printed.** The same pages as the web export, from the same functions of
`@inkadra/canvas-core` and `@inkadra/print` (`planSheetInput`, `planSheetPages`, `renderPdf`).

- `audience=team`: every card, and "Day N" from the board's shooting days, as the schedule
  shows them to the member (decision 0092: dates and blocks, never calls).
- `audience=client`: without cards hidden from guests and without "Day N".
- Guests: only the cards the link shows (the guest view the server already cuts, which drops a
  plan's links to hidden cards, 0111), the board's frame labels, and never "Day N". A plan
  hidden from guests is 404.
- Background pictures: the smallest ready variant at least 2048 px wide, else the largest, as
  the web picks; a guest gets only pictures the link shows. A picture not ready or failing is
  left out, as on the web. The grey option uses the same `greyPixels` as the web, so a grey
  background has R = G = B.
- Fonts: the four Inter TTFs of `@expo-google-fonts/inter` the web uses (Latin Extended and
  Cyrillic, update of 0038), read once per process, measured with the same `measureFrom`. The
  server then depends on fontkit, so the patch `patches/@pdf-lib__fontkit@1.1.1.patch` must
  apply in the server image: the `pnpm deploy` of the server stops allowing unused patches.

**Response.** `200 application/pdf`, the whole file in the answer (no job: one sheet is
expected to take well under 2 s). `Content-Disposition: attachment` with the web export's file
name; `Cache-Control: private, no-cache`; `X-Content-Type-Options: nosniff` and the sandbox CSP
of other served files. `ETag`: a hash of the stored document's version (`board_doc.updatedAt`),
the plan id, the normalised query, the resolved language and audience, the background
variants used (storage key and row version) and the server version; guests add the link's
`updatedAt`. `If-None-Match` with the same tag answers 304. Access is checked on every request,
304 included.

The sheet is drawn from the stored document, which the collaboration server writes at most 10 s
after an edit: a sheet asked right after an edit may not have it yet. Accepted.

**Access and errors** (existing `ErrorCode`s only).

- Members: viewer role or above on the board. No role, no such plan or an element that is not a
  plan: 404 `not_found`, as everywhere. No session: 401.
- Guests: the guest session of the link. No session: 401; a password needed again or a link
  expired, revoked or suspended: 403 with `GuestDenied`; board not on the link, no such plan or
  a plan hidden from guests: 404.
- 400 `invalid_request` for a bad query.
- 429 `rate_limited` with `Retry-After`: more than 10 sheets a minute by one account or guest,
  or, with `details: { reason: "busy" }`, the server is already rendering its 2 sheets. Busy
  reuses 429 rather than adding a 503 code, which would be a change to `ErrorCode`. Clients
  wait `Retry-After` seconds (5 when busy) before trying again.

**Limits.** At most 2 renders at once per server process (a third is 429 busy); a render
stops after 20 s (500, logged with board and plan id only); 10 sheets a minute per account or
guest, counted apart from guest writes; at most 20 setups and one background picture of at
most 2048 px per setup. No result cache: the ETag spares repeats. The server pull request
measures time and memory of a large plan with 3 setups on the workstation and quotes them.

**Parity.** The web goldens already hold the Op list of the sheet (`apps/web/src/board/export/
golden/plan-sheet-*`, from `@inkadra/canvas-core/fixtures/plan-sheet`). The server pull request
exports its pipeline as a function and compares its pages with the same golden files, team and
guest, in two languages; checks that the guest PDF's text lacks the fixture's hidden card; checks
the grey pixels of the server's picture path against `grey-pixels.txt` and that the embedded
grey background has R = G = B; and adds a golden pair with "Day N" (team) and without (guest).

**Older servers.** Servers that answer advertise the capability `plan-sheet-pdf`
(`PLAN_SHEET_PDF_CAPABILITY` in `packages/shared`) on `GET /api/v1/instance/version`. The app
shows "PDF" only when it is there. An older server called anyway answers like any unknown
`/api/v1` route: 404 `not_found`, the same as a plan the caller cannot see, so only the
capability tells them apart. Guests cannot read `/instance/version`; the guest web only offers
the button when it is served by a server that has the route.

## Not covered

- The web app keeps exporting in the browser: it already has the pipeline, works offline and
  can print an area of the plan.
- Viewers with a grant on one board get the member route and "Day N", like the schedule.
- Whether the guest web offers a "PDF" button using the guest route is decided with that
  change; the route exists for it and for the app.
