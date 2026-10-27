// SPDX-License-Identifier: MPL-2.0
import { FractionalIndex, Id, Timestamp, z } from './common.ts';
import { ProjectRole } from './projects.ts';

export const BoardKind = z.enum(['board', 'storyboard']);
export type BoardKind = z.infer<typeof BoardKind>;

export const Board = z
  .object({
    id: Id,
    projectId: Id,
    parentBoardId: Id.nullable().openapi({ description: 'Null only for the project root board.' }),
    kind: BoardKind,
    title: z.string().min(1).max(200),
    position: FractionalIndex,
    coverAssetId: Id.nullable(),
    docSchemaVersion: z.int().min(1).openapi({
      description:
        'Version of the Yjs document schema (@inkadra/doc-schema) stored for this board.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    editedAt: Timestamp.optional().openapi({
      description: 'Latest metadata or document change, returned by the project board list.',
    }),
    myRole: ProjectRole,
  })
  .openapi('Board');
export type Board = z.infer<typeof Board>;

export const BoardCrumb = Board.pick({ id: true, title: true }).openapi('BoardCrumb');

export const BoardDetail = Board.extend({
  breadcrumb: z.array(BoardCrumb).openapi({ description: 'From the project root to the parent.' }),
}).openapi('BoardDetail');
export type BoardDetail = z.infer<typeof BoardDetail>;

export const CreateBoard = z
  .object({
    parentBoardId: Id,
    kind: BoardKind.default('board'),
    title: z.string().trim().min(1).max(200),
  })
  .openapi('CreateBoard');
export type CreateBoard = z.infer<typeof CreateBoard>;

export const UpdateBoard = z
  .object({
    title: z.string().trim().min(1).max(200),
    parentBoardId: Id,
    position: FractionalIndex,
    coverAssetId: Id.nullable(),
  })
  .partial()
  .openapi('UpdateBoard');
export type UpdateBoard = z.infer<typeof UpdateBoard>;

/** A board on the signed-in person's Home, from every project they can open. */
export const RecentBoard = Board.extend({
  projectName: z.string(),
  editedAt: Timestamp.openapi({
    description: 'Last change of the board itself or of its document, whichever is later.',
  }),
}).openapi('RecentBoard');
export type RecentBoard = z.infer<typeof RecentBoard>;

export const RecentBoardQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(12) })
  .openapi('RecentBoardQuery');
export type RecentBoardQuery = z.infer<typeof RecentBoardQuery>;

/** Bounded projection of the last persisted document, never a full canvas download. */
export const BoardPreview = z
  .object({
    assetIds: z.array(Id).max(4),
    excerpts: z.array(z.string().max(160)).max(3),
    elementCount: z.int().nonnegative(),
    drawing: z
      .array(
        z.object({
          path: z.string().max(5000),
          color: z.string().regex(/^#[0-9A-F]{6}$/i),
          width: z.number().positive().max(820),
        }),
      )
      .max(32),
  })
  .openapi('BoardPreview');
export type BoardPreview = z.infer<typeof BoardPreview>;

export const BoardCount = z
  .object({
    boardId: Id,
    elementCount: z.int().nonnegative(),
    frameCount: z.int().nonnegative().openapi({ description: 'Storyboard frames on the board.' }),
    framesToShoot: z
      .int()
      .nonnegative()
      .openapi({ description: 'Frames whose status is not `shot` yet.' }),
  })
  .openapi('BoardCount');
export type BoardCount = z.infer<typeof BoardCount>;
export const BoardCounts = z.object({ items: z.array(BoardCount) }).openapi('BoardCounts', {
  description: 'Counts of the project boards the caller can open, for the navigation.',
});
export type BoardCounts = z.infer<typeof BoardCounts>;
