# 0123 · The Production board: one schedule per project, across storyboards

Proposed, 2026-11-12. The design of step 4 of [0121](0121-board-types.md), which asked for "its
own design for moved, deleted and restored storyboards, archives and guest documents". Builds on
0022 and 0089 (schedule), 0091 and 0092 (Troupe, day calls), 0083 (scene sheets), 0119 (the set
plan's shooting days) and the mockup [0121/board-types.html](0121/board-types.html) ("Produzione").

## Context

Checked in the code on `main` at 1063aed7:

- `shooting_day` (`apps/server/src/db/schema.ts`) has `project_id`, `board_id` (cascade), the
  blocks and the calls as JSONB, and an index on `(board_id, date)`. A shot block names its frame
  by `shotId` alone, an element id of the day's own board (`ScheduleBlock`,
  `packages/shared/src/schedule.ts`). A block holds no scene: the scene is the frame's parent.
  A shot block's `title` is empty; its label ("12A") is computed from the live document and
  reads "missing shot" when the frame is gone (`ScheduleView.tsx`, `shotTitle`).
- Every reader of days goes by board id: the schedule routes (`http/schedule-routes.ts`), Home
  (`/me/shooting-days`, same file), the calendar feed (`http/calendar-routes.ts`), search
  (`http/search-routes.ts`), the card's `dayCount` (`http/boards-routes.ts`, storyboards only),
  the project archive (`transfers/export.ts`, `import.ts`: `schedule.json`, format 1), the
  cast-link merge (`cast-crew.ts`, `mergeCastLinks`), and on the web the calendar, the phone's
  call sheet, call and scene sheets (`export/planning.ts`, `ExportDialog.tsx`) and the set plan's
  shooting days (`plan/sun-days.ts`). The open #657 (plan sheet on the server) adds one more.
- The crew is the project table `crew_member`, under `/projects/{id}/crew`, members only (0091).
- Deleting a board sets `deleted_at` on its subtree (`DELETE /boards/{id}`); no route brings a
  board back (the trash of 0026 restores cards; a board card brings back the link only). Days of a
  trashed board stay in the table; Home, the feed and search leave them out.
- A board moves only inside its project: `PATCH` refuses a parent of another project.
- Days are not in board documents or versions (0022): restoring a version never touches them.
- Guests have no schedule or crew route (`http/guest-routes.ts`).
- The web reads a storyboard's frames from its live document (`useStoryboard`,
  `film/storyboard-data.ts`); the call sheet reads location and character cards, set plans and
  needed items from the same store (`CallSheetModal.tsx`, `export/planning.ts`).
- An archive import gives boards new ids and keeps element ids (`transfers/remap.ts`).
- Going back to an older version after its migrations ran is not supported; a backup is the way
  back (`docs/self-hosting/upgrades.md`).
- The mobile app is not started (`apps/mobile/README.md`); no other client reads the schedule.

Not checked: the e2e fixtures and the screenshot scripts that seed days.

## Decision

### 1. Data model

- **Kind `production`** in `BoardKind`, with Schedule and Troupe always on and no optional view
  (`OPTIONAL_VIEWS.production = []`). `schedule` and `troupe` stay in `BoardOptionalView`, since
  stored storyboards list them, but no kind allows them once the interim goes (step 6).
- **One per project, in the database:** a partial unique index on `board (project_id)` where the
  kind is `production`, trashed rows included, so a deleted Production board is brought back with
  its days rather than a second schedule starting beside it (§3). Rejected: a check in the route only
  (two requests at once pass it); an index that skips trashed rows (two schedules, one unreachable).
- **No sub-boards in it:** creating or moving a board under a Production board is refused (400);
  it has no canvas to hold their cards.
- **A day belongs to the Production board:** `shooting_day.board_id` is its id; `project_id`
  stays. Tables, routes and the revision checks are unchanged. Rejected: days keyed by project
  (new routes and a second access rule where a board already gives one); days kept on a
  storyboard (one day shoots several storyboards).
- **A shot block points across boards** with two optional fields: `shotBoardId`, the board whose
  document holds `shotId`, and `shotLabel`, the frame's label as last seen (at most 40
  characters). The pair is the reference: element ids are unique only inside one document, and an
  import keeps them. A block without `shotBoardId` belongs to the day's board (days from before).
  The client writes `shotLabel` when it adds the block and again whenever it saves the day with
  that storyboard read; it is shown only when the storyboard cannot be read (in the trash, no
  access, offline, still loading). Nothing else is copied: the picture, the action, the scene and
  the set plans come live from the storyboard; cast stays the block's own list, as today.
  Rejected: copying the frame (stale, and private to whoever cannot open that storyboard).
- **Checks at the boundary:** a new or changed `shotBoardId` must be a board of the day's project
  (400 otherwise); a reference the stored block already had is kept, even to a board trashed
  since. A client that sends blocks without the two keys keeps them, by block id, as
  `keepBlockNotes` keeps notes (`schedule-routes.ts`).
- **Its document holds nothing.** The Production board has a Yjs document like every board; the
  schedule and the crew stay in Postgres (0022, 0091). Versions and Trash are not offered on it.
  Rejected: a board without a document (opening, indexing, exporting and versions all assume
  one); references in its document (a schema change and offline merging for rows that already
  have revisions).
- **For the way back:** `shooting_day.moved_from` (uuid, no foreign key), set only by the move
  below and never read by the app, keeps the board a day came from.

### 2. Moving existing projects

One server function, `adoptDays(tx, projectId, productionId)`, moves days; creating a Production
board and the startup step both call it, in one transaction under an advisory lock per project:

1. Lock the project's days (`for update`, by id).
2. For each day on another board that is not in the trash: shot blocks without `shotBoardId` get
   that board's id; `moved_from` gets it too; `board_id` becomes the Production board; the
   revision goes up by one, so an open calendar gets a 409 and reloads instead of saving over.
3. Days of boards in the trash stay where they are, as hidden as today.

Every day moves as it is. Days of several storyboards are not merged: two days on one date get a
column each (0089). Days of an ordinary board (possible before 0121) move too and keep pointing at
that board's frames. Calls, attendance answers (keyed by day id) and the crew are not touched.

**Which projects** (step 6, at start, under an advisory lock like `mergeCastLinks`, idempotent):
each project, archived ones included, without a Production board whose live boards have days or
whose crew is not empty. It gets a Production board under the root, after its last child, titled
"Production" in the language of the project's creator (the mail texts, else English), with
`created_by` null; then `adoptDays`. A second run finds nothing to do.

**Its card** is not added by the migration: the server writes into documents only where they are
live (0014), and nothing is live at start. The board is in the sidebar tree and the storyboard's
⋯ menu leads to it (§5); question 2 asks whether the root canvas should get its card.

**Rolling back.** For the instance, as for any release with migrations: restore the backup taken
before the upgrade (`upgrades.md`). For the data, the move only changes `board_id`, the revision
and adds keys, so a project can be put back by hand:

```sql
update shooting_day
set board_id = moved_from, moved_from = null,
    blocks = (select coalesce(jsonb_agg(b.v - 'shotBoardId' - 'shotLabel' order by b.i), '[]')
              from jsonb_array_elements(blocks) with ordinality as b(v, i))
where project_id = $1 and moved_from is not null;
```

then the Production board is trashed. The keys go because an older server refuses unknown block
keys (`ScheduleBlock` is strict).
Days created on the Production board after the move stay on it. This statement is tested in the
pull request of step 6 against the migration's fixture; no command is shipped for it.

**Archives** become format 2. Export writes the Production board and its days with the two keys;
import maps `shotBoardId` through the new board ids (an id not in the archive drops the key and
keeps `shotLabel`, so the block reads "missing shot"). A format 1 archive with days gets a
Production board on import and `adoptDays` (archives carry no crew, 0091); the demo project,
imported from an archive, takes the same path. An older server refuses format 2 with its
"unsupported version" error, read before anything else (`import.ts`), instead of misreading the
references.

**An older web tab**, until it takes the new version, shows the Production board as an empty
ordinary board and an empty Schedule on the storyboard; saving a moved day there gets a 409 and
keeps the draft (0089). From step 6, creating a day on any other board is refused (409,
`details.reason: 'production_board'` with the Production board's id, 0016).

### 3. Lifecycle

- **A storyboard goes to the trash:** its days stay on the Production board; its blocks show
  `shotLabel` with the grey "not available" dot, and its frames leave the queue.
- **A storyboard comes back from the trash:** no route does this today; if one comes, nothing is
  needed, the references are ids.
- **A storyboard is restored to an older version (0109):** frames that come back resolve again;
  frames that leave read as missing. Days are not written.
- **A storyboard moves in the tree:** nothing changes but who can read it.
- **A frame is deleted:** its block stays (0022), with `shotLabel` and "missing shot"; undoing
  the deletion brings it back.
- **Scenes are renumbered** by a screenplay revision (0082): labels are live; `shotLabel` follows
  at the next save. An omitted scene keeps its scheduled frames and leaves the queue, as today.
- **The Production board goes to the trash:** days and calls stay in the table; Schedule and Troupe
  leave the project (0121); Home, the feed and search drop the days as for any trashed board.
  "Add → Production" brings that board back (`deleted_at` cleared, under the chosen parent) with
  every day; the index never allows a second one. Question 3.
- **A crew but no Production board:** rows kept, crew routes unchanged for API clients; the web
  shows no Troupe, and search returns crew results only while a Production board is live (they
  open its Troupe).
- **A project is deleted:** everything cascades, as today.

### 4. Access

| Who                           | Days                    | Calls, block notes | Crew           |
| ----------------------------- | ----------------------- | ------------------ | -------------- |
| Project member                | by board role           | yes                | read; editors write |
| Grant on the Production board | by grant role           | no                 | no             |
| Grant on a storyboard only    | no                      | no                 | no             |
| Guest, share link             | no                      | no                 | no             |

- Days follow the Production board's role, inherited or granted, like any board's content. Calls
  and block notes stay for project members (0092), the crew for members and project editors
  (0091).
- A block from a storyboard the reader cannot open shows its time, type, title, cast and
  `shotLabel`, with a grey dot named "Storyboard not available": no picture, no frame fields, no
  board title (the client knows only boards it can read).
- A grant on a storyboard alone no longer shows a schedule: its scene sheets and set plans show no
  day. Question 1.
- The Production board is left out of a share link's board tree (`share-links.ts`), and a share
  link on it is refused (400): it holds nothing a guest may read.
- The calendar feed stays members only; an event is titled "Production board · project".
  Call sheets are built in the browser for the team; the client export builds none and its scene
  sheets get no days (0090, 0092, unchanged).
- The server reads no storyboard document for the Production board: the browser opens each one
  with the person's own role.

### 5. Interface

- **The calendar across storyboards.** The Production board's Schedule opens the documents of the
  project's storyboards the person can read, and of any board a block points to, through the
  existing board connection. The queue groups their frames by storyboard, then scene. Filters:
  Storyboard (All, then each with its dot), Scene (with All, prefixed by the storyboard), Cast.
  Frames already scheduled are keyed by board and frame. `shortcut:` every readable storyboard
  opens at once; open them on demand when a project has more than about ten.
- **The dot** is the storyboard's icon colour when it has one, else a colour of the identity
  palette in order of creation among the project's storyboards, trashed ones counted so colours
  never shift. It marks queue items, blocks, the day panel and the card, always, with the
  storyboard's name as its label.
- **Call sheets** open from a day, as now, and from the Production board's Export ("Call
  sheets"). Each block's frame is read from its own board; location and character cards are
  matched across that day's storyboards, the first in tree order winning on a shared name.
- **Scene sheets** stay in the storyboard's Export (one scene per sheet, 0083). "A shooting day"
  and the production department read the Production board's days, keeping the blocks that point
  at this storyboard; without access to it there are no days. The set plan's shooting days (0119)
  and its sheet's "Day N" (0122) read the same way; Day N counts the Production board's days.
- **A storyboard** loses Schedule and Troupe in its header, the sidebar and its card. Its ⋯ menu
  shows "Shooting days: 3 · Open Production" when the project has a Production board the person
  can open and a block points at this storyboard; nothing otherwise. Rejected: a read-only
  calendar on the storyboard (two calendars for one plan).
- **The Production board's header:** name, tabs Schedule and Troupe, ⋯. "Views of this board"
  lists both checked, "always", and "This type has no other views" (mockup). It opens on Schedule;
  the phone's picker lists both.
- **Its card:** Schedule shows the next shooting day (the first on or after today, else the last):
  "Day N · date", place and call, its first five blocks with time, dot and label or title, then
  "+N days". Troupe shows the first four people with their role and "+N people" to members, the
  existing "hidden" text to others. `BoardPreview` gains `nextDay` and `crew`, both bounded and
  optional; `dayCount` and `crewCount` move from the storyboard's card to this one.
- **The Canvas menu** offers "Production · Schedule + Troupe" while the project has no live
  Production board (one in the trash is brought back, §3). With one, the card is dimmed, "Already
  in the project", and opens it. With the module off, it is dimmed with Turn on (0121).
- **The module registry:** `production.kinds = ['production']`, `views = []`; the `shortcut:`
  comments in `modules.ts` and `boards.ts` go. Off keeps the thin line on a colleague's board.
- **Tours:** Schedule and Troupe open on the Production board; the schedule tour gains a step on
  the Storyboard filter and the dots; the Canvas menu tour shows the Production card.

### 6. Delivery

1. **Contract** (label `contract`): `BoardKind` gains `production`; `ScheduleBlock` gains
   `shotBoardId` and `shotLabel`; `BoardPreview` gains `nextDay` and `crew`; archive format 2;
   migration with the unique index and `moved_from`; OpenAPI. The server keeps the two keys of a
   block by id. Tests: schemas, a second production board refused by the index, an older client's
   save keeps the keys. Safe: no production board can exist yet beyond the API, nothing reads the
   keys.
2. **Server:** creating a Production board (one per project, 409 `production_exists`, the trashed
   one brought back, no sub-boards under it), `adoptDays` on creation, the `shotBoardId` check,
   share links and guest trees without it, its card counts and preview, archives export and import
   (both formats), crew search results opening the Production board, `mergeCastLinks` and #657
   reading days by project. Tests: server tests for each,
   an import round trip, a format 1 import. Safe: the web does not offer the kind yet.
3. **Web, the readers of a storyboard's days:** scene sheets, the set plan's days and its sheet
   read the Production board's days filtered by board, or the board's own days while the project
   has none. Tests: unit tests of the filter and of `sceneDay` with board ids. Safe: same result
   in every project without a Production board.
4. **Web, the Production board:** kind, icon, views, header, sidebar, Canvas menu, the calendar
   across storyboards, Troupe, call sheet export, module registry, tours, texts in every catalogue.
   While a project has no Production board its storyboards keep the interim views. Tests: unit,
   e2e (create it, plan frames of two storyboards, a block whose storyboard is trashed), tours
   test, screenshots light and dark, 1280 and 390 px.
5. **Web, its card preview** (Schedule and Troupe tabs). Tests: unit, screenshots.
6. **The move of every project and the end of the interim:** the startup step of §2, the
   storyboard's ⋯ link, days refused on other boards, and the removal of Schedule and Troupe from
   storyboards (`OPTIONAL_VIEWS`, `views.ts`, the shortcut comments, the storyboard's tours). Tests:
   the migration on a fixture (days on two storyboards, on an ordinary board, on a trashed board, a
   crew-only project, an empty one), run twice, and the rollback statement; e2e of a migrated
   project.

### Not built

Scene blocks (question 4), a route that brings a board back from the trash, moves between
projects, a server projection of storyboards for the calendar, scene sheets of several
storyboards from the Production board, a command that reverses the move, notifications about
days.

## Open questions for the maintainer

1. **A grant on a storyboard alone.** Today it shows that storyboard's days; after the move the
   days are the Production board's. (a) Access follows the Production board: give a grant there to
   whoever needs the plan; recommended, nothing is hidden from the team. (b) The migration gives a
   viewer grant on the Production board to every grant on a storyboard that had days: they also
   see the days of the other storyboards. (c) The server filters each day's blocks by the
   storyboards the reader can open: a second access rule inside one board.
2. **The card of a migrated Production board.** (a) The first editor who opens the root board
   gets its card placed by their client, once, with an id derived from the board's (two clients
   write the same card) and a mark in the root's `meta` so a card someone removed does not come
   back; recommended, as in the mockup. (b) No card: the sidebar and the storyboard's link lead
   there; a person can place it from the Canvas menu.
3. **Deleting the Production board.** (a) It goes to the trash with its days; "Add → Production"
   brings it back with them; recommended. (b) It cannot be deleted while it has days. (c) Add makes
   a new empty one and the old days stay in the trash, unreachable.
4. **Scenes without frames.** (a) Days plan frames, as today; a scene is planned through its
   frames; recommended. (b) A block can point at a scene, so the queue offers scenes not yet drawn:
   a new block reference, and the call and scene sheets learn it.

## Consequences

- The schedule becomes the project's, one calendar for every storyboard, without a new table or
  route; the price is a browser that opens several storyboard documents on the Production board.
- Day ids never change, so attendance answers, calls and links keep working through the move.
- Project archives move to format 2; older servers refuse them clearly.
- Six pull requests; the interim views of 0121 go in the last, once no project needs them.
