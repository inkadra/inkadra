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
