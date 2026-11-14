# Instance backup format (version 1)

Instance backups (`inkadra-backup-<date>-<id>.zip`, administrators only) hold the database of one
Inkadra server. They are not meant to be read by other tools; the reasons are in
[decision 0037](../decisions/0037-export-import-and-backups.md) and the schema of the manifest
is `BackupManifest` in [`packages/shared/src/backups.ts`](../../packages/shared/src/backups.ts).

| Entry             | Content                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `manifest.json`   | `format: "inkadra-backup"`, version, applied migrations, tables, rebuilt tables |
| `db/<table>.copy` | The rows of one table, PostgreSQL `COPY` text format                            |
| `files.jsonl`     | One line per stored file: key, size, SHA-256 when known                         |
| `media.jsonl`     | Backups with files only: one line per file inside, key, size and SHA-256        |
| `media/<key>`     | Backups with files only: the stored file of that key, stored (not deflated)     |

`tables` lists the included tables of the `public` schema in load order: a table after every table it
references. Rows of `board` are written parents first and rows of `comment` thread starts
first, so loading each entry with `COPY … FROM` in order needs neither deferred constraints nor
a superuser. `rebuilt` names tables left out because a restore rebuilds them
(`board_element_index`, the search index; `storage_total`, the running storage totals kept
by triggers as files are loaded). `bytea` columns are hex in text format.

Backup and project-transfer bookkeeping (`instance_backup`, `project_transfer`) is omitted.
Playable video copies are omitted too: no `asset_rendition` rows or `proxy` variants, and
queued, processing or ready proxy states become `skipped`. Regenerate copies from
Settings → Video after restoring; they are not automatically rebuilt.

`files.jsonl` lists non-pending assets, non-proxy variants and unexpired feedback attachments
from the same snapshot. Size and checksum can be null; variant sizes are not recorded. Files are
not inside the backup unless **Include files** is on (#899): back up the data volume or the
bucket as it is (files never change once written). Restore into an empty database with
`docker compose run --rm inkadra backup restore <file>`, using a version whose migration history contains the backup's history as a prefix. Restore checks file
existence and known sizes, not checksums.

Each table entry and `files.jsonl` carry an optional `sha256` in the manifest (servers before
#794 leave it out). After writing an archive the server reads it back: every table is counted
and hashed against the manifest and every listed file is looked up in storage; an archive that
does not match is not kept (`corrupt`).

With **Include files** on, the files of `files.jsonl` are copied after the snapshot of the
tables, one at a time, each into `media/<key>`; `media.jsonl` lists each with its size and the
SHA-256 of the bytes written, and the manifest's optional `media` gives their count, bytes, the
files storage no longer had (`missing`) and the SHA-256 of `media.jsonl`. The verification reads
every file back against it, and a restore writes the files storage lacks (or has with another
size) back into storage, the local disk or the bucket, before checking the list. Playable copies
of videos and ladder rungs are never inside: they are made again. Office page previews are not
listed, so they are not inside either: regenerate them after a restore. Servers before #899
restore only the database of such an archive. Keep `.env` too: encrypted secrets require the
original `AUTH_SECRET`. See [Restoring](../self-hosting/README.md#restoring).

Backups contain password hashes, sessions and sealed tokens: keep them like the database.
