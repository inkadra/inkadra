# Project archive format (version 2)

An Inkadra project archive is a zip file (`.zip`, deflate or stored entries, no encryption)
with the layout below. The schemas of every JSON entry are in
[`packages/shared/src/project-archive.ts`](../../packages/shared/src/project-archive.ts); the
reasons behind the format are in [decision 0037](../decisions/0037-export-import-and-backups.md).
All JSON is UTF-8; timestamps are ISO 8601 with offset; ids are UUIDs of the exporting server.

| Entry                            | Content                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `manifest.json`                  | `format: "inkadra-project"`, `formatVersion`, app version, date, counts          |
| `project.json`                   | Name, icon, type, shooting dates, archived                                       |
| `people.json`                    | Id and name of every author and mentioned person (never emails)                  |
| `boards.json`                    | Board tree: id, parent (null for root), kind, views, title, icon, schema version |
| `boards/<boardId>/document.yjs`  | The board's Yjs document, one full update (`Y.encodeStateAsUpdate`)              |
| `boards/<boardId>/elements.json` | The same board readable: elements as in `@inkadra/doc-schema`, note text         |
| `versions.json`                  | Named versions: id, board, name, schema version, author, date                    |
| `versions/<versionId>.yjs`       | The document of a named version                                                  |
| `assets.json`                    | Files: id, kind, MIME type, name, size, SHA-256, author                          |
| `files/<assetId>`                | The original file, byte for byte                                                 |
| `comments.json`                  | Comments and replies (board or card, pin, resolved, edited, deleted)             |
| `reviews.json`                   | The team's review status of each card and its history                            |
| `schedule.json`                  | Shooting days with their blocks                                                  |
| `classifications.json`           | Labels of the project type, tags and custom shot values used, by name            |
| `export-settings.json`           | PDF and image export settings of the project and its logo (an asset id)          |
| `guests.json`                    | Review decisions and photo proofing of share link guests, by guest name          |

Inside documents, cards refer to files by `assetId` (image, file, frame, and the picture of a
character or location card, from schema version 7), `references` (the reference pictures of a
character card, from schema version 17) or `imageAssetId` (link) and to boards by
`boardId` (board cards); `meta.boardId` names the board itself. Element ids are stable:
comments, reviews and schedule blocks refer to cards by them.
`elements.json` also has the storyboard's `aspect` and, from document version 9,
`animaticAudio` (`{ assetId, volume }`, the sound track of its animatic, decision 0046; the
app no longer plays it, decision 0047) or null.

Authors are ids of `people.json`. Comment bodies write mentions as `@{personId}`; a deleted
comment keeps its place with an empty body. `guestName` marks a comment written by a guest of a
share link (links are not exported). `sha256`, when present, is the checksum of `files/<id>`.
Boards in the trash are not in the archive, nor anything under them or on them.
`export-settings.json` is there only when the project saved its export settings (decision
0039); its `logoAssetId` is one of `assets.json`.

`guests.json` (decision 0086, absent from older archives and from projects no guest reviewed
or proofed) keeps what guests of share links decided: `reviews`, the current decision of each
link on a card; `history`, every decision a guest made or withdrew; and `picks`, what each
guest picked, rejected or starred (1 to 5), with the picture the card showed (`assetId`, one of
`assets.json`, or null). Rows name a guest of `guests` (the name they typed, null once retention
cleared it), and each guest one of `links`: its board, label, role and whether it had proofing.
Links and guests get ids made for the archive. Nothing else of a link is exported: no address,
token, password, expiry, use count or session, and no email.

A file that is missing, too large or does not match its checksum is skipped. Its cards stay:
image and file cards then show a missing file, while optional pictures (the reference of a
storyboard frame, the preview of a link, the picture of a character or location, the sound
track of an animatic) are removed. A skipped logo leaves the project without one.

## Reading an archive

Without Inkadra, `elements.json`, `comments.json` and `files/` are enough to read a project.
Note text is in each note's `text`; drawings are in `strokes` and `shapes` on a 4096-unit grid.
Character and location cards (decision 0044) hold the story bible: names, roles, actors,
contacts, addresses and their linked scene numbers in `scenes`.

## Compatibility

Importers refuse a `formatVersion` they do not know and documents with a schema newer than
their own. From 1.0 every later version keeps reading version 1. Entries and keys not listed
here are ignored (dropped while reading), so additions readers can ignore keep the version;
anything a version 1 reader would get wrong bumps it.

**Version 2** (decision 0123): the shooting days belong to the project's Production board (kind
`production`, at most one, with no board under it). A block names the board of its frame with
`shotBoardId` and its label as last seen with `shotLabel`; a `scene` block names its scene with
`sceneId`, `sceneBoardId` and `sceneLabel`. A block without the board id belongs to the day's
board. An import maps the board ids to the new ones and drops one that is not in the archive,
keeping the label. A version 1 archive with days gets a Production board on import, and its days
move there as on a running server. A version 1 server refuses version 2 as unsupported.

An Inkadra import checks the archive before writing anything: limits in
`PROJECT_ARCHIVE_LIMITS`, no duplicate, encrypted or symbolic-link entries, the tree and
references (`checkArchiveStructure`). A file whose checksum does not match is skipped. People
are never matched to accounts: everything imported belongs to the importer and keeps the
original author's name for display. Each link of `guests.json` becomes a link of the new project
that is already revoked, with a token nobody was given, and its guests have no session: the
team sees their decisions in the review history and their picks in the link's results, and
nobody can open the link or act as a guest. As for any stopped link, retention clears guest
names 90 days later (after the import).

## Instance backups

Instance backups are a different format, described in [instance-backup.md](instance-backup.md).
