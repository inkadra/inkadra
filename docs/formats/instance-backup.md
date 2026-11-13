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

`tables` lists the included tables of the `public` schema in load order: a table after every table it
references. Rows of `board` are written parents first and rows of `comment` thread starts
first, so loading each entry with `COPY … FROM` in order needs neither deferred constraints nor
a superuser. `rebuilt` names tables left out because a restore rebuilds them
(`board_element_index`, the search index). `bytea` columns are hex in text format.

Backup and project-transfer bookkeeping (`instance_backup`, `project_transfer`) is omitted.
Playable video copies are omitted too: no `asset_rendition` rows or `proxy` variants, and
queued, processing or ready proxy states become `skipped`. Regenerate copies from
Settings → Video after restoring; they are not automatically rebuilt.

`files.jsonl` lists non-pending assets, non-proxy variants and unexpired feedback attachments
from the same snapshot. Size and checksum can be null; variant sizes are not recorded. Files are
not inside the backup: back up the data volume or the bucket as it is (files never change once
written). Restore into an empty database with
`docker compose run --rm inkadra backup restore <file>`, using a version whose migration history contains the backup's history as a prefix. Restore checks file
existence and known sizes, not checksums. Keep `.env` too: encrypted secrets require the
original `AUTH_SECRET`. See [Restoring](../self-hosting/README.md#restoring).

Backups contain password hashes, sessions and sealed tokens: keep them like the database.
