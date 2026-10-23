// SPDX-License-Identifier: MPL-2.0
import { ListLimit } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/**
 * Saved states of a board document (docs/decisions/0013). Each version is a full Yjs update
 * kept in Postgres. Restoring writes the old content on top of the live document as a new
 * change, so open boards follow and nothing of the current state is lost: it is saved first
 * as a `restore` version.
 */

/** Named versions a board keeps at most; delete one to save another. */
export const MAX_NAMED_VERSIONS = 100;

export const BoardVersionKind = z.enum(['auto', 'named', 'restore']).openapi({
  description:
    '`auto`: taken by the server while the board is edited, removed by retention. `named`: ' +
    'saved by someone with a name, kept until deleted. `restore`: the state just before a ' +
    'restore, kept like an automatic one. Open: clients show a kind they do not know like ' +
    '`auto`.',
});
export type BoardVersionKind = z.infer<typeof BoardVersionKind>;

export const BoardVersion = z
  .object({
    id: Id,
    boardId: Id,
    kind: BoardVersionKind,
    name: z.string().nullable(),
    createdBy: UserSummary.nullable().openapi({ description: 'Null for automatic versions.' }),
    createdAt: Timestamp,
    size: z.int().min(0).openapi({ description: 'Bytes of the stored state.' }),
    elementCount: z.int().min(0),
    docSchemaVersion: z.int().min(1),
    expiresAt: Timestamp.nullable().openapi({
      description: 'When retention will remove it; null for named versions.',
    }),
  })
  .openapi('BoardVersion');
export type BoardVersion = z.infer<typeof BoardVersion>;

export const BoardVersionQuery = z
  .object({
    kind: BoardVersionKind.optional(),
    cursor: Cursor.optional(),
    limit: ListLimit,
  })
  .openapi('BoardVersionQuery');

export const CreateBoardVersion = z
  .object({ name: z.string().trim().min(1).max(120) })
  .openapi('CreateBoardVersion');
export type CreateBoardVersion = z.infer<typeof CreateBoardVersion>;

export const UpdateBoardVersion = z
  .object({
    name: z.string().trim().min(1).max(120).openapi({
      description: 'Naming an automatic version makes it `named`, so retention keeps it.',
    }),
  })
  .openapi('UpdateBoardVersion');
export type UpdateBoardVersion = z.infer<typeof UpdateBoardVersion>;

export const RestoredBoardVersion = z
  .object({
    restored: BoardVersion,
    backup: BoardVersion.openapi({ description: 'The state the board had before the restore.' }),
  })
  .openapi('RestoredBoardVersion');
export type RestoredBoardVersion = z.infer<typeof RestoredBoardVersion>;
