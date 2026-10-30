// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

/** Instance backups for administrators (docs/decisions/0037). */
export const BACKUP_RETENTION_MAX = 90;

export const BackupSettings = z
  .object({
    enabled: z.boolean().openapi({ description: 'Nightly backup on or off. Default on.' }),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .openapi({ description: 'Daily start, `HH:MM` in `timeZone`. Default `03:00`.' }),
    retention: z
      .int()
      .min(1)
      .max(BACKUP_RETENTION_MAX)
      .openapi({ description: 'Successful backups kept; older ones are removed. Default 7.' }),
  })
  .openapi('BackupSettings');
export type BackupSettings = z.infer<typeof BackupSettings>;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  time: '03:00',
  retention: 7,
};

export const UpdateBackupSettings = BackupSettings.partial()
  .strict()
  .openapi('UpdateBackupSettings');
export type UpdateBackupSettings = z.infer<typeof UpdateBackupSettings>;

export const InstanceBackup = z
  .object({
    id: Id,
    trigger: z.enum(['scheduled', 'manual']),
    status: z.enum(['running', 'ready', 'failed']),
    fileName: z.string().nullable().openapi({
      description: 'Name of the archive in `DATA_DIR/backups` (and `backups/` of the bucket).',
    }),
    size: z.number().int().min(0).nullable(),
    copiedToBucket: z.boolean().openapi({ description: 'A copy went to the S3 bucket too.' }),
    files: z
      .object({ count: z.int().min(0), bytes: z.number().int().min(0) })
      .nullable()
      .openapi({ description: 'Stored files the backup lists (they are not inside it).' }),
    failure: z
      .string()
      .nullable()
      .openapi({
        description:
          'Why it failed, for the log. `interrupted`: the worker stopped and the backup made no ' +
          'progress for 15 minutes; it no longer blocks the next one.',
      }),
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
  })
  .openapi('InstanceBackup');
export type InstanceBackup = z.infer<typeof InstanceBackup>;

export const InstanceBackups = z
  .object({
    settings: BackupSettings,
    timeZone: z.string().openapi({ description: 'Time zone of the server (`TZ`), read only.' }),
    bucket: z.boolean().openapi({ description: 'Files live in S3: backups are copied there.' }),
    nextRunAt: Timestamp.nullable(),
    items: z.array(InstanceBackup).openapi({ description: 'Newest first, at most 30.' }),
  })
  .openapi('InstanceBackups');
export type InstanceBackups = z.infer<typeof InstanceBackups>;

/**
 * Tables a backup leaves out: derived data that a restore rebuilds (the search index is filled
 * again from the documents by the startup backfill).
 */
export const BACKUP_REBUILT_TABLES = ['board_element_index'] as const;

/**
 * `manifest.json` of an instance backup archive (docs/formats/instance-backup.md). `tables`
 * is in load order: a table comes after every table it references, and rows of tables that
 * reference themselves (`board` parents, `comment` threads) are written parents first, so a
 * plain `COPY … FROM` per table restores without deferred constraints or superuser rights.
 */
export const BACKUP_FORMAT = 'inkadra-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BackupManifest = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.int().min(1),
  appVersion: z.string().max(64),
  createdAt: Timestamp,
  /** Database migrations applied when the backup was taken, in order. */
  migrations: z.array(z.string().max(200)).max(10_000),
  tables: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
        columns: z
          .array(z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/))
          .min(1)
          .max(200),
        rows: z.int().min(0),
        entry: z.string().regex(/^db\/[a-z_][a-z0-9_]{0,62}\.copy$/),
      }),
    )
    .max(500),
  /** Tables left out on purpose (`BACKUP_REBUILT_TABLES` of the version that wrote it). */
  rebuilt: z.array(z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/)).max(500),
  /** Files listed from the `asset` and `asset_variant` rows of the same snapshot. */
  files: z.object({
    count: z.int().min(0),
    bytes: z.number().int().min(0),
    entry: z.literal('files.jsonl'),
  }),
});
export type BackupManifest = z.infer<typeof BackupManifest>;
