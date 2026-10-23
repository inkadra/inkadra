// SPDX-License-Identifier: MPL-2.0
import { Id, z } from './common.ts';

/**
 * Global search over projects, boards and the cards inside them. Card content is read from
 * the board documents into an index on the server (see docs/decisions/0012), so results can
 * lag a few seconds behind the last edit.
 */
export const SearchQuery = z
  .object({
    q: z.string().trim().max(200).optional().openapi({
      description: 'Words to find in titles, notes, captions, shot data and file names.',
    }),
    projectId: Id.optional().openapi({ description: 'Search one project only.' }),
    tag: z.string().trim().min(1).max(40).optional().openapi({
      description: 'Only cards with this tag (compared without case).',
    }),
    type: z.string().max(20).optional().openapi({
      description: 'Only cards of this element type, e.g. `frame` or `image`.',
    }),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => (v.q !== undefined && v.q.length > 0) || v.tag !== undefined, {
    message: 'Send q, tag or both.',
  })
  .openapi('SearchQuery');
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z
  .object({
    kind: z.enum(['project', 'board', 'element']),
    projectId: Id,
    projectName: z.string(),
    boardId: Id.nullable(),
    boardTitle: z.string().nullable(),
    boardKind: z.enum(['board', 'storyboard']).nullable(),
    elementId: z.string().nullable(),
    elementType: z
      .string()
      .nullable()
      .openapi({
        description:
          'Element type from @inkadra/doc-schema. Clients show types they do not know as plain ' +
          'results.',
      }),
    title: z.string().openapi({ description: 'Best short label: name, title, shot or file.' }),
    snippet: z.string().nullable().openapi({ description: 'Text around the match.' }),
    assetId: Id.nullable().openapi({ description: 'Picture to show next to the result.' }),
    tags: z.array(z.string()),
  })
  .openapi('SearchHit');
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResult = z.object({ items: z.array(SearchHit) }).openapi('SearchResult');
export type SearchResult = z.infer<typeof SearchResult>;

export const TagCount = z.object({ tag: z.string(), count: z.int().min(1) }).openapi('TagCount');
export type TagCount = z.infer<typeof TagCount>;
