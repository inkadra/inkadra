// SPDX-License-Identifier: MPL-2.0
import { BoardKind } from './boards.ts';
import { Id, z } from './common.ts';
import { ProjectRole } from './projects.ts';

/**
 * Global search over projects, boards and the cards inside them. Card content is read from
 * the board documents into an index on the server (see docs/decisions/0012), so results can
 * lag a few seconds behind the last edit.
 */
export const SearchQuery = z
  .object({
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .openapi({
        description:
          'Words to find in titles, notes, captions, shot data and file names; also the crew ' +
          '(name, role, department; project members only) and the locations of shooting days.',
      }),
    projectId: Id.optional().openapi({ description: 'Search one project only.' }),
    tag: z.string().trim().min(1).max(40).optional().openapi({
      description: 'Only cards with this tag (compared without case).',
    }),
    type: z
      .string()
      .max(20)
      .optional()
      .openapi({
        description:
          'Only cards of this element type, e.g. `frame` or `image`. With `projectId` and ' +
          'without `q` or `tag`, lists the named cards of that type the caller can read ' +
          '(since API 0.10.0).',
      }),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  // A type within one project lists those cards, e.g. the characters of a project.
  .refine(
    (v) =>
      (v.q !== undefined && v.q.length > 0) ||
      v.tag !== undefined ||
      (v.type !== undefined && v.projectId !== undefined),
    { message: 'Send q, tag or both, or a type with a project.' },
  )
  .openapi('SearchQuery');
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z
  .object({
    kind: z.enum(['project', 'board', 'element']),
    projectId: Id,
    projectName: z.string(),
    boardId: Id.nullable(),
    boardTitle: z.string().nullable(),
    boardKind: BoardKind.nullable(),
    elementId: z.string().nullable(),
    elementType: z
      .string()
      .nullable()
      .openapi({
        description:
          'Element type from @inkadra/doc-schema. Clients show types they do not know as plain ' +
          'results. Two are not cards: `crew`, a person of the crew (`elementId` is the crew ' +
          'row, the board the root board), and `shootingDay`, a shooting day found by its ' +
          'location (`elementId` is the day, `snippet` its date).',
      }),
    title: z.string().openapi({ description: 'Best short label: name, title, shot or file.' }),
    snippet: z.string().nullable().openapi({ description: 'Text around the match.' }),
    assetId: Id.nullable().openapi({ description: 'Picture to show next to the result.' }),
    tags: z.array(z.string()),
    myRole: ProjectRole.optional().openapi({
      description:
        'Role of the caller on the board of the result (on the project, for projects), e.g. to ' +
        'leave out boards a clip cannot go to. Missing from servers before API 0.5.0.',
    }),
  })
  .openapi('SearchHit');
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResult = z.object({ items: z.array(SearchHit) }).openapi('SearchResult');
export type SearchResult = z.infer<typeof SearchResult>;

export const CastAppearancesQuery = z.object({
  excludeBoardId: Id.optional().openapi({
    description: 'Leave out this board, whose frames the caller already has live.',
  }),
});
export type CastAppearancesQuery = z.infer<typeof CastAppearancesQuery>;

export const CastAppearances = z
  .object({
    items: z.array(
      z.object({
        name: z.string().openapi({ description: 'A name of a frame cast, in lower case.' }),
        frames: z.int().min(0),
        scenes: z.array(z.string()).openapi({ description: 'Numbers of the scenes.' }),
      }),
    ),
  })
  .openapi('CastAppearances');
export type CastAppearances = z.infer<typeof CastAppearances>;

export const PlanKitQuery = z.object({
  excludeBoardId: Id.optional().openapi({
    description: 'Leave out this board, whose plans the caller already has live.',
  }),
});
export type PlanKitQuery = z.infer<typeof PlanKitQuery>;

export const PlanKit = z
  .object({
    items: z.array(
      z.object({
        key: z.string().openapi({ description: 'Same key, same light or camera.' }),
        icon: z
          .object({
            kind: z.string().openapi({ description: 'Icon kind of the set plan.' }),
            label: z.string().optional(),
            make: z.string().optional(),
            watts: z.number().optional(),
            power: z.string().optional(),
            gel: z.string().optional(),
            stand: z.string().optional(),
            kelvin: z.number().optional(),
            role: z.string().optional(),
            beam: z.number().optional(),
            intensity: z.number().optional(),
            lens: z.number().optional(),
            support: z.string().optional(),
            color: z.string().optional(),
            percent: z.number().optional(),
            size: z.string().optional(),
          })
          .openapi({ description: 'What a copy placed from the kit starts with.' }),
        modifiers: z.array(z.string()).openapi({ description: 'Kinds attached to the light.' }),
        lenses: z.array(z.number()).openapi({ description: 'Focal lengths of a camera, in mm.' }),
      }),
    ),
  })
  .openapi('PlanKit');
export type PlanKit = z.infer<typeof PlanKit>;

export const TagCount = z.object({ tag: z.string(), count: z.int().min(1) }).openapi('TagCount');
export type TagCount = z.infer<typeof TagCount>;
