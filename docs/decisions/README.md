# Decisions

Short records of choices that are not obvious from the code. One file per decision, numbered
in order. An accepted decision is never rewritten: a later one supersedes it.

| #                                                    | Decision                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [0001](0001-monorepo.md)                             | One repository, pnpm workspaces and Turborepo                                          |
| [0002](0002-one-image-several-roles.md)              | One Docker image with several roles                                                    |
| [0003](0003-api-contract.md)                         | API contract: Zod first, OpenAPI generated, `/api/v1`                                  |
| [0004](0004-data-split.md)                           | Board content in Yjs, everything else in Postgres                                      |
| [0005](0005-authentication.md)                       | Better Auth, first account is administrator                                            |
| [0006](0006-design-tokens.md)                        | Design tokens, Inter, dark first                                                       |
| [0007](0007-licence.md)                              | AGPL-3.0 and allowed dependency licences                                               |
| [0008](0008-licences-per-component.md)               | Licence per component (AGPL, MPL-2.0) and DCO                                          |
| [0009](0009-files-and-media.md)                      | Files: tus uploads, immutable storage, worker thumbnails                               |
| [0010](0010-images-and-releases.md)                  | How images are built, checked and released                                             |
| [0011](0011-collaboration-and-access.md)             | Roles per board, invitations, app tokens, presence                                     |
| [0012](0012-storyboards-and-search.md)               | Shot lists in the board document, a search index                                       |
| [0013](0013-review-and-sharing.md)                   | Comments, approvals, guest links and versions                                          |
| [0014](0014-server-side-board-edits.md)              | Clips: cards the server adds where the board is live                                   |
| [0015](0015-installable-web-app.md)                  | Installable web app with a hand-written service worker                                 |
| [0016](0016-error-reasons-in-details.md)             | Error reasons go in `details`, not in new codes                                        |
| [0017](0017-conservative-error-outcomes.md)          | Missing error reasons leave mutation outcomes unknown; supersedes 0016 retry semantics |
| [0018](0018-cookie-only-auth-responses.md)           | Keep session tokens out of browser-readable auth responses                             |
| [0019](0019-invitation-links-up-to-editor.md)        | Invitation links give at most the editor role; amends 0011                             |
| [0020](0020-file-captions.md)                        | Keep captions on file cards                                                            |
| [0021](0021-templates-on-existing-boards.md)         | Templates on existing boards (removed by 0067); Storyboard creates a real board        |
| [0022](0022-shooting-schedule.md)                    | Shooting schedules in Postgres, storyboard references by id                            |
| [0023](0023-home-overview.md)                        | Home overview from two read-only lists                                                 |
| [0024](0024-project-setup-and-personal-pins.md)      | Project setup and personal pins                                                        |
| [0025](0025-classification-catalogs.md)              | Instance classification catalogs                                                       |
| [0025](0025-instance-administration.md)              | Instance settings and member administration                                            |
| [0026](0026-snapshot-trash.md)                       | Restore individual elements from saved versions                                        |
| [0027](0027-project-identity-palette.md)             | Extend project identity without changing existing defaults                             |
| [0028](0028-authentication-hardening.md)             | Authentication hardening: limits in Valkey, second factor everywhere, browser policies |
| [0029](0029-settings-window.md)                      | Settings open as a window over the current page                                        |
| [0030](0030-authentication-follow-ups.md)            | Authentication follow-ups without contract changes                                     |
| [0033](0033-canvas-and-tool-colours.md)              | Canvas types keep the content colours, tools get their own, one Canvas menu            |
| [0034](0034-share-link-password-contract.md)         | Align share-link password contracts with the ten-character server minimum              |
| [0035](0035-request-origins-and-canonical-links.md)  | Request origins for browser traffic, canonical URLs for external links                 |
| [0036](0036-personal-clip-history.md)                | Personal clip destination history shared across browsers                               |
| [0037](0037-export-import-and-backups.md)            | Project archives in an open format, logical instance backups without pg_dump           |
| [0038](0038-pdf-and-image-export.md)                 | PDF and image export built in the browser                                              |
| [0039](0039-project-export-settings.md)              | PDF and image export settings stored per project                                       |
| [0040](0040-screenplay-import.md)                    | Screenplay import from Fountain and Final Draft, read in the browser                   |
| [0041](0041-expiring-access-and-project-creation.md) | Expiring access for people with an account; who can create projects                    |
| [0042](0042-video-frame-grab.md)                     | Video stills and their source                                                          |
| [0043](0043-arrow-labels-and-styles.md)              | Arrow labels and styles: straight or curved, line, ends                                |
| [0044](0044-character-and-location-cards.md)         | Character and location cards for the story bible                                       |
| [0045](0045-image-crop-and-rotation.md)              | Non-destructive image crop and rotation                                                |
| [0046](0046-animatic-sound-track.md)                 | Animatic timeline and sound track, played by guests                                    |
| [0047](0047-remove-animatic-and-sequence-modes.md)   | Animatic and Sequence modes removed; their data is kept                                |
| [0048](0048-media-worker-previews.md)                | Media worker previews: playable video copies, camera RAW and PDF pages                 |
| [0049](0049-floating-desktop-shell.md)               | Desktop shell: floating panels over a full-bleed board                                 |
| [0050](0050-link-card-video-playback.md)             | Link cards: inline video playback, Vimeo and Instagram                                 |
| [0051](0051-audio-cards.md)                          | Audio cards: waveform, AAC copies and voice notes                                      |
| [0052](0052-table-cards.md)                          | Table cards: plain-text cells in Yjs, pasted from spreadsheets                         |
| [0053](0053-maps.md)                                 | Map cards and GPX routes: static pictures made once by the server, explored on request |
| [0054](0054-design-previews.md)                      | Design source files: bounded embedded previews and shared cards                        |
| [0055](0055-personal-preferences.md)                 | Personal preferences that follow the person: one JSON record per account               |
| [0056](0056-personal-project-groups.md)              | Personal project groups: organisation only, per person, never access                   |
| [0057](0057-project-theme.md)                        | Project theme: accent, bundled heading fonts and logo (partly superseded by 0088)      |
| [0058](0058-needed-items-by-shooting-day.md)         | Needed items: typed to-do lists linked to scenes, rolled up by shooting day            |
| [0059](0059-model-font-previews.md)                  | Bounded model and font metadata, scoped browser font specimens                         |
| [0060](0060-release-news.md)                         | Opt-in release news and SMTP delivery claims                                           |
| [0061](0061-calendar-feed.md)                        | Private calendar subscriptions: revocable bearer URL, bounded read-only ICS            |
| [0062](0062-set-plans.md)                            | Set plans: frame strokes and shapes plus set icons on a card of their own              |
| [0064](0064-pdf-screenplay-import.md)                | PDF screenplays read in a disposable browser worker, with bounded size, pages and time |
| [0065](0065-office-previews.md)                      | Optional Office previews: sandboxed LibreOffice worker, bounded spreadsheet grids      |
| [0066](0066-password-change-keeps-the-session.md)    | A password change closes the other sessions and keeps the one that made it             |
| [0067](0067-remove-project-and-board-templates.md)   | Remove project and board templates; keep empty creation and film views                 |
| [0068](0068-contextual-appearance.md)                | Contextual card appearance stored in the document, with a read-only guard              |
| [0069](0069-in-app-feedback.md)                      | In-app reports: to the developers by default, through a private GitHub relay           |
| [0069](0069-richer-character-sheet.md)               | Richer character sheet, with scenes worked out from the frames                         |
| [0070](0070-frame-editing-and-capture.md)            | Frames: pictures moved in, full-screen Draw, stills from the original video            |
| [0071](0071-simpler-set-plan.md)                     | A simpler set plan: two bars, proportional icons, routes                               |
| [0071](0071-storyboard-catalogs.md)                  | Shot size, angle and movement as instance catalogs                                     |
| [0072](0072-social-image-formats.md)                 | Pictures in social formats, with bars in the board background colour                   |
| [0073](0073-more-languages-english-fallback.md)      | Four more languages, English as the fallback, catalogues loaded on demand              |
| [0075](0075-cast-links-and-presence.md)              | Optional cast links and presence per day, answered only for oneself                    |
| [0077](0077-removed-assignees-are-corrected.md)      | A stale assignee is corrected, not refused                                             |
| [0078](0078-tutorials.md)                            | Animated tutorials, offered once and kept in step with the interface                   |
| [0079](0079-server-page.md)                          | A Server page for administrators, without a monitoring stack                           |
| [0080](0080-update-check.md)                         | The server checks GitHub for new releases                                              |
| [0081](0081-storage-limits.md)                       | Storage limits per instance and per person                                             |
| [0082](0082-script-revisions.md)                     | Update a storyboard from a revised screenplay; omitted scenes stay in place            |
| [0083](0083-scene-sheets.md)                         | Scene sheets by department, made of what the board already holds                       |
| [0084](0084-public-demo.md)                          | A public demo, closed by default                                                       |
| [0085](0085-two-demo-projects.md)                    | Two sample projects in the demo, the film and a photo shoot                            |
| [0086](0086-guest-decisions-in-archives.md)          | Guest decisions and proofing travel with the archive, on revoked links                 |
| [0087](0087-no-export-presets.md)                    | No audience presets and no kickoff summary in the PDF export                           |
| [0088](0088-theme-in-export-dialog.md)               | Heading style in the export dialog; the accent is always the project's colour          |
| [0089](0089-schedule-calendar.md)                    | Schedule as a calendar: blocks queue up, saved on its own, sun worked out on device    |
| [0090](0090-call-sheet-at-a-glance.md)               | Call sheet at a glance: step 1 of Troupe, using existing board data                    |

| [0091](0091-troupe.md) | Private project crew, grouped departments and sheet paste |
| [0092](0092-day-calls.md) | Per-person calls of a shooting day, block notes and the crew on the call sheet |
| [0093](0093-reference-board.md) | A reference board grown through a real Yjs history, for performance work |
| [0094](0094-lighter-core-reads.md) | Strokes and table rows validated once per item; helpers read the BoardStore snapshot |
| [0095](0095-cast-roles-day-address-and-search.md) | A Cast row's role is its character, the day's address on the call sheet, search finds crew and day locations |
| [0096](0096-authenticated-client-compatibility.md) | The authenticated version endpoint lists API, document schema and stable capability names |
| [0097](0097-client-asset-identifiers.md) | `clientAssetId` in tus creation: the asset id is a UUIDv5 of it in the uploader's namespace; a deleted id is never made again |
| [0098](0098-idempotent-creations.md) | `Idempotency-Key` on board and comment creation; a retry reads the created resource as it is now |
| [0099](0099-invalid-token-reasons.md) | A REST 401 says why a recognised token stopped working; revoked hashes kept apart for 30 days |
| [0100](0100-incremental-board-index.md) | Only affected containers are indexed and sorted after a board edit |
| [0101](0101-strict-card-check.md) | A strict per-card check finds what a build does not understand; copies carry cards as stored |
| [0102](0102-min-writer-schema.md) | `minWriterSchema`: older clients write only when a test proves they lose nothing; the schema does not freeze at 1.0 |
| [0103](0103-idempotent-project-creations.md) | `Idempotency-Key` also on project, crew member and shooting day creation, with its own capability; links are checked only when something is created |
| [0104](0104-set-plan-v2.md) | Set plan v2: 163 glyphs, opaque fills and stacking by type, attachments, walls and openings, light fields, power per circuit, links to cards; schema 23 |
| [0104](0104-hand-checked-strokes.md) | Pen strokes are checked by a hand-written equivalent of their schema; Zod decides everything else |
| [0105](0105-hydration-scheduler-and-priority.md) | Hydration takes a scheduler, cards to read first and an opt-in progressive view of only those; `applyUpdate` stays one block |
| [0106](0106-validated-snapshots.md) | A snapshot of the validated view, bound to the build, the board and each card's Yjs items, lets an open skip unchanged cards |
| [0107](0107-weight-700-for-user-bold.md) | Inter 700 only for bold the user writes; the interface stops at 600 (amends 0006) |
| [0108](0108-shell-sizes-from-tokens.md) | The shell reads its sizes (236 / 42 / 42 / 12) from `tokens.layout` (amends 0006) |
| [0109](0109-board-restore-marker.md) | A restore that changes the board increments `meta.restores` in the same transaction, so offline clients can tell before they send |
| [0111](0111-set-plan-links-and-outputs.md) | Set plan links resolved where the plan is drawn, never written; a deleted card leaves its text; sun for exteriors; setups in the shot list and schedule; export dialog, PDF sheet, read-only view, card counts, power on the call sheet |
| [0112](0112-board-restore-history.md) | The last 50 restores of a board are kept with who, the count and the version's name as it was; editors read them, others only counts and times |
| [0113](0113-token-proof.md) | `token-proof`: a key bound to an app token lets the server prove it issued the token, over a fresh nonce, before a client on an unconfirmed network sends it |
| [0114](0114-set-plan-item-lock-and-project-kit.md) | Set plan: `locked` on each plan item (schema 24), the project kit read across the boards the caller can read, Grip and crew as a group of Elements |
| [0116](0116-set-plan-setups-share-circuits.md) | Set plan: setups share the base's circuits, voltage and title; the first setup is renamed like the others; "All setups" counts distinct items |

A few numbers are shared by two decisions (0025, 0054, 0069, 0071, 0104): they were accepted in parallel,
and accepted records are not renumbered.
