# Decisions

Short records of choices that are not obvious from the code. One file per decision, numbered
in order. An accepted decision is never rewritten: a later one supersedes it.

| #                                        | Decision                                                 |
| ---------------------------------------- | -------------------------------------------------------- |
| [0001](0001-monorepo.md)                 | One repository, pnpm workspaces and Turborepo            |
| [0002](0002-one-image-several-roles.md)  | One Docker image with several roles                      |
| [0003](0003-api-contract.md)             | API contract: Zod first, OpenAPI generated, `/api/v1`    |
| [0004](0004-data-split.md)               | Board content in Yjs, everything else in Postgres        |
| [0005](0005-authentication.md)           | Better Auth, first account is administrator              |
| [0006](0006-design-tokens.md)            | Design tokens, Inter, dark first                         |
| [0007](0007-licence.md)                  | AGPL-3.0 and allowed dependency licences                 |
| [0008](0008-licences-per-component.md)   | Licence per component (AGPL, MPL-2.0) and DCO            |
| [0009](0009-files-and-media.md)          | Files: tus uploads, immutable storage, worker thumbnails |
| [0010](0010-images-and-releases.md)      | How images are built, checked and released               |
| [0011](0011-collaboration-and-access.md) | Roles per board, invitations, app tokens, presence       |
| [0012](0012-storyboards-and-search.md)   | Shot lists in the board document, a search index         |
| [0013](0013-review-and-sharing.md)       | Comments, approvals, guest links and versions            |
| [0014](0014-server-side-board-edits.md)  | Clips: cards the server adds where the board is live     |
| [0015](0015-installable-web-app.md)      | Installable web app with a hand-written service worker   |
| [0016](0016-error-reasons-in-details.md) | Error reasons go in `details`, not in new codes          |
