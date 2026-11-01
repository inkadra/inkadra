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
| [0021](0021-templates-on-existing-boards.md)         | Templates on existing boards; Storyboard creates a real storyboard board               |
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

Two decisions share the number 0025: they were accepted in parallel, and accepted records
are not renumbered.
