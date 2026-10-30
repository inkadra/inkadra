// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

/**
 * Project exports and imports (docs/decisions/0037). Both run in the background: the request
 * returns a transfer at once and the client follows it until it is `ready` or `failed`.
 */
export const TransferKind = z.enum(['export', 'import']);
export type TransferKind = z.infer<typeof TransferKind>;

export const TransferStatus = z.enum(['queued', 'running', 'ready', 'failed']).openapi({
  description:
    '`queued`: waiting for the worker. `running`: being built or read. `ready`: an export can ' +
    'be downloaded until `expiresAt`; an import created `projectId`. `failed`: see `failure`.',
});
export type TransferStatus = z.infer<typeof TransferStatus>;

export const TRANSFER_FAILURES = [
  /** The archive is larger than the instance accepts. */
  'too_large',
  /** Not a zip, a missing or malformed entry, or content that does not match the format. */
  'invalid_archive',
  /** A format version this server does not read. */
  'unsupported_version',
  /** Board documents of a newer schema than this server knows. */
  'too_new',
  /** Reading or writing files failed. */
  'storage',
  /** The requester lost access to the project, or it was deleted, while the export ran. */
  'gone',
  /** The worker stopped (restart, crash) and the transfer made no progress for 15 minutes. */
  'interrupted',
  /** The person removed it while it ran. */
  'cancelled',
  'internal',
] as const;
export const TransferFailure = z.string().openapi({
  description: `Why a transfer failed. Known values: ${TRANSFER_FAILURES.map((f) => `\`${f}\``).join(', ')}. Open: clients show unknown values as a generic failure.`,
});

export const TransferSummary = z
  .object({
    boards: z.int().min(0),
    elements: z.int().min(0),
    files: z.int().min(0),
    comments: z.int().min(0),
    /** Files listed by the archive but missing from it or refused: the cards stay, empty. */
    skippedFiles: z.int().min(0),
    /** Comment and review authors without an account of the same email here. */
    remappedPeople: z.int().min(0),
  })
  .openapi('TransferSummary');
export type TransferSummary = z.infer<typeof TransferSummary>;

export const ProjectTransfer = z
  .object({
    id: Id,
    kind: TransferKind,
    status: TransferStatus,
    progress: z.number().min(0).max(1).openapi({
      description: 'Share of the work done, 0 to 1 (stored in thousandths, so steps of 0.001).',
    }),
    projectId: Id.nullable().openapi({
      description:
        'Export: the exported project (null once deleted). Import: the new project, set when ready.',
    }),
    projectName: z.string(),
    size: z.number().int().min(0).nullable().openapi({ description: 'Archive size in bytes.' }),
    failure: TransferFailure.nullable(),
    summary: TransferSummary.nullable().openapi({ description: 'Counts, once ready.' }),
    createdAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    expiresAt: Timestamp.nullable().openapi({
      description: 'Exports only: the archive is removed after this.',
    }),
  })
  .openapi('ProjectTransfer');
export type ProjectTransfer = z.infer<typeof ProjectTransfer>;

export const ProjectTransfers = z
  .object({
    items: z.array(ProjectTransfer),
    nextCursor: z.null().openapi({
      description: 'Always null for now: the list is short. Reserved for paging later.',
    }),
  })
  .openapi('ProjectTransfers', {
    description: "The caller's transfers of the last seven days, newest first.",
  });
export type ProjectTransfers = z.infer<typeof ProjectTransfers>;

/** Hours an export stays downloadable. */
export const EXPORT_TTL_HOURS = 24;
