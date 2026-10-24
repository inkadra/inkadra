// SPDX-License-Identifier: MPL-2.0
import { ElementRef } from './comments.ts';
import { Id, z } from './common.ts';

/**
 * Body of POST /api/v1/clip when sent as JSON. Files are sent as multipart instead,
 * with the same fields plus a `file` part. Used by the browser clipper and the mobile share sheet.
 */
export const ClipRequest = z
  .object({
    boardId: Id,
    columnId: z.string().max(64).optional().openapi({
      description: 'Element id of a column in the board document. Omit to use "Non ordinati".',
    }),
    url: z.url().optional(),
    text: z.string().max(20_000).optional(),
    sourceUrl: z.url().optional().openapi({ description: 'Page the content was taken from.' }),
    note: z.string().max(2_000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    title: z
      .string()
      .max(500)
      .optional()
      .openapi({
        description:
          'Links: the title of the card, instead of the one read from the page (e.g. the tab ' +
          'title). Ignored for texts and files. Servers before API 0.5.0 ignore it.',
      }),
  })
  .refine((v) => v.url !== undefined || v.text !== undefined, {
    message: 'Send a url, a text or a file.',
  })
  .openapi('ClipRequest');
export type ClipRequest = z.infer<typeof ClipRequest>;

export const ClipResult = z
  .object({
    boardId: Id,
    elementId: z.string(),
    assetId: Id.nullable(),
  })
  .openapi('ClipResult');
export type ClipResult = z.infer<typeof ClipResult>;

/** A column of a board document, as a place to clip to. */
export const BoardColumn = z
  .object({
    id: ElementRef.openapi({ description: 'For ClipRequest.columnId.' }),
    title: z.string().openapi({ description: 'May be empty: clients show a placeholder.' }),
  })
  .openapi('BoardColumn');
export type BoardColumn = z.infer<typeof BoardColumn>;

export const BoardColumns = z
  .object({
    items: z.array(BoardColumn).openapi({
      description:
        'Columns of the stored board document, left to right and then top to bottom. Without ' +
        '"Non ordinati", which is not a column: omit columnId to clip there.',
    }),
  })
  .openapi('BoardColumns');
export type BoardColumns = z.infer<typeof BoardColumns>;
