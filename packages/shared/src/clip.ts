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
