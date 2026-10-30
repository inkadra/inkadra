# 0037 — Project export and import, instance backups

## Context

Two 1.0 criteria are "export a project and reimport it on a fresh instance gives the same
result" and "upgrade without data loss". Until now the only advice was to dump Postgres and
copy the data volume by hand. A project lives in three places (decision 0004): rows in
Postgres, Yjs documents in `board_doc`, and files in local or S3 storage.

## Decision

### Project archive (an open format)

A project exports to a zip whose layout and JSON entries are described by Zod schemas in
`packages/shared/src/project-archive.ts` (MPL-2.0) and documented in
[docs/formats/project-archive.md](../formats/project-archive.md). Each board is there twice: the
Yjs document as stored (the source on import, lossless) and a readable `elements.json` built
with doc-schema (for people and other tools, never read back). Originals are included as
uploaded; thumbnails are not, the importing server makes them again. `manifest.json` carries
`format`, `formatVersion` (1), the app version, the export date and the highest board schema
version inside.

What goes in: project metadata, the board tree, documents, named versions (automatic ones are
not), files, comments, the team's review statuses and their history, shooting days, and the
labels of the classifications used, and the project's export settings with their logo
(decision 0039). Boards in the trash are left out with everything under them
and everything on them (comments, reviews, versions, shooting days). The archive is a team
artifact: cards hidden from guests (`guestHidden`) and `team` threads are included. Comments
deleted in the thread keep their place with an empty body. What stays out: members and board
grants, share links with their guests, picks and guest review decisions, invitations,
notifications, automatic versions, and any email address. These are about people and access on
one server, not content.

### Who may export and import

- **Export**: owners and editors of the project (project role, decision 0011). The project role
  decides, not board grants: a grant can lower an editor to viewer on one board, and that board
  and its originals are still in the archive. Viewers already download originals one by one,
  and an editor of a project is trusted with its content; checking every board grant would make
  archives that silently miss boards. The archive is downloadable only by the person who asked
  for it, and only while they are still owner or editor.
- **Import**: any active account, one import at a time per person (each holds a whole archive
  on disk). The result is a new project owned by the importer, with no other member. The
  importer then invites people as usual.
- **Sessions and tokens**: export and import accept personal tokens as well as sessions; they
  give nobody access they did not have, so they need no fresh sign-in. Backup endpoints accept
  only a signed-in administrator session, never a token: backups contain every account's
  password hash.

### Import never trusts the archive

The upload is stored as one file and read by the worker. Entries are looked up by names the
importer builds from validated ids, so names in the archive never become paths (no zip-slip).
Before reading, the central directory is checked: no duplicate names, no encrypted entries, no
symbolic links, zip64 sizes that agree with the local headers, and declared sizes within limits
(`PROJECT_ARCHIVE_LIMITS`: entry count, JSON and document sizes, a compression ratio per entry;
`UPLOAD_MAX_SIZE` per file; `IMPORT_MAX_SIZE` for the archive compressed and for the sum of
entries uncompressed). While reading, actual sizes are counted and must match. Every JSON entry
is parsed with its schema (unknown keys are dropped), row counts are capped (boards, files,
comments, versions, review rows, people), and `checkArchiveStructure` checks the rules schemas
cannot: one root, no cycle, unique ids, and every cover, thread, version, review and shooting
day pointing inside the archive, replies on the board of their thread start. Documents must
load in Yjs, stay under an element count per board, pass `validateBoardDoc` and are migrated
like any stored document (a newer schema fails with `too_new`). A file whose SHA-256 is given
and does not match is skipped and counted in `skippedFiles`; its cards stay, empty. File types
are taken from the content when it is a picture and must agree with the declared kind;
anything else is stored as a plain file. `sourceUrl` must be an `http(s)` address. Files then
go through the normal media pipeline (thumbnails, EXIF, palette), queued like uploads; without
a worker they are processed inside the web process as uploads are.

Projects, boards, files, comments and versions get new ids; references are rewritten in rows
and inside documents (`assetId`, `imageAssetId`, board cards, `meta.boardId`, `createdBy`).
Element ids stay, so comments, reviews and schedule blocks still point at their cards.

People are never matched. Matching by email would let anyone who writes an archive by hand
put words in the name of an account of the importing server, and would carry email addresses
of a whole team to wherever the archive goes. So `people.json` holds names only (authors and
mentioned people), everything imported belongs to the importer (`author_id`, `created_by`,
`changed_by`, `user_id`), and the original author's name is kept as display-only text in an
`imported_author` column of comments, reviews and their history, versions and files. The API
shows such authors as `{ kind: "imported", name }` (an open `Author` kind, API 0.8.0) and
versions carry `importedAuthor`. Mentions `@{id}` turn into plain `@Name`. Comments written by
guests become `team` threads with the guest's name as their imported author: share links are
not exported, and a guest thread without a link would read, under decision 0013, as visible to
every link.

### Background work

Exports and imports are `project_transfer` rows run by the worker on a `transfers` queue, one
at a time. Archives live in `DATA_DIR/transfers`, which the web and worker roles already share
in every supported deployment. Progress is stored in the row (thousandths) and polled by the
client; every step also moves `updated_at`. When the work ends the requester gets an in-app
notification (`export_ready`, `import_ready`, never emailed) that leads to the project; the
archive itself is found in `GET /transfers`. Deleting a running transfer marks it failed
(`cancelled`) and the worker, which re-reads the row between steps, stops: this works whichever
process runs it. Exports are removed after 24 hours, failed and finished imports right away.
An hourly sweep marks rows `running` or `queued` without progress for 15 minutes as failed
(`interrupted`), removes expired archives, and deletes any file in `DATA_DIR/transfers` that no
row claims (left by a crash). Without Redis the same code runs inside the web process.

### Instance backups without pg_dump

The image does not ship `pg_dump`: its version must match the server's major version, which
the image cannot know. Backups are instead a logical export built in Node: in one read-only
repeatable-read transaction every table of the `public` schema is written with `COPY … TO
STDOUT` (text format) into a zip, with the list of applied migrations and a `files.jsonl`
manifest of every stored file. The file list comes from the `asset` and `asset_variant` rows of
the same snapshot (key, size, SHA-256 of originals), never from listing storage, so it matches
the database exactly. Files are not copied: they never change once written (decision 0009), so
the data volume or the bucket is backed up as it is.

Foreign keys are not deferrable and a restore must not need a superuser, so order matters.
Tables are written in dependency order (a table after every table it references) and rows of
the two tables that reference themselves are written parents first: `board` by depth in its
tree (`parent_board_id`), `comment` thread starts before replies (`thread_id, board_id`). A
restore then loads each table with one `COPY … FROM` in the same order. Derived tables are left
out and rebuilt: `board_element_index` (search) is filled again from the documents by the
startup backfill; `asset_variant` rows are kept because their files are in storage. `bytea`
columns (`board_doc`, `board_version`) are hex in text format, about twice their size before
the zip deflates them.

A running backup moves `heartbeat_at` every few seconds. A `running` row whose heartbeat is
older than 15 minutes is marked failed (`interrupted`) before any new backup starts and by the
hourly sweep, so a crash never blocks the next backup through the one-running index.

Backups run nightly at a time the administrator sets (default 03:00 in the server's `TZ`), keep
the last 7 by default, are written to `DATA_DIR/backups` and, when files are in S3, copied to
`backups/` in the bucket. "Back up now" queues one more. Only one runs at a time. Archives are
never served over HTTP: administrators copy them from the volume or the bucket, and the
`backups/` prefix must never be public (files are served by the server, never by bucket URLs).

Restoring is a command, not an endpoint: `node /app/dist/main.js backup restore <file>` on an
empty database. It applies the migrations the backup had, loads the tables, applies the newer
migrations of the running version, and reports files listed in the manifest that storage does
not have. So a backup taken by an older version restores on a newer one (upgrade without data
loss); one from a newer version is refused.

## Consequences

- New tables `project_transfer` and `instance_backup`, `imported_author` columns, API 0.8.0
  (additive: endpoints, the `imported` author kind, `BoardVersion.importedAuthor`),
  notification types `export_ready` and `import_ready`, new environment variable
  `IMPORT_MAX_SIZE`.
- `formatVersion` of both archives freezes with 1.0 like the document schema: later versions
  must keep reading version 1. Additions that readers can ignore (a new optional entry or key)
  keep the version, since readers drop what they do not know; anything a version 1 reader
  would get wrong bumps it.
- Imported projects lose who wrote what as accounts: names stay readable, but nobody is
  notified about old threads, and imported comments belong to the importer.
- Reverse proxies in front of Inkadra must let an archive through: `client_max_body_size` in
  nginx, and Cloudflare's 100 MB request limit on its free plans, which only a direct route or
  a smaller archive avoids.
- Backups contain password hashes, sessions and sealed tokens: they are as sensitive as the
  database and are not downloadable from the browser. Sealed tokens need the same
  `AUTH_SECRET` after a restore.
- An export reads documents as stored; edits made in the last seconds before it (still in the
  collaboration server's debounce) may be missing.
