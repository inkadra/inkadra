// SPDX-License-Identifier: MPL-2.0
import { FractionalIndex, Id, Timestamp, z } from './common.ts';
import { CLIP_BOARD_HISTORY_LIMIT } from './constants.ts';
import { ProjectIcon, ProjectRole } from './projects.ts';
import { ScheduleBlock, ScheduleTime } from './schedule.ts';

/** What a board is, chosen when it is made: the set of views it has (decision 0121). */
export const BoardKind = z.enum(['board', 'moodboard', 'storyboard', 'production']);
export type BoardKind = z.infer<typeof BoardKind>;

/**
 * The views a board can turn on or off; the others always come with its kind. `schedule` and
 * `troupe` stay for storyboards stored before decision 0123, which list them: no kind allows them
 * any more, and a stored list that names them is read without them.
 */
export const BoardOptionalView = z.enum(['moodboard', 'shotlist', 'schedule', 'troupe', 'review']);
export type BoardOptionalView = z.infer<typeof BoardOptionalView>;

/**
 * The views each kind may turn on (decision 0121): a board its moodboard and review (a guest
 * review link can be made on any board), a storyboard its shot list and review. Schedule and
 * Troupe belong to the Production board (decision 0123).
 */
export const OPTIONAL_VIEWS: Record<BoardKind, readonly BoardOptionalView[]> = {
  board: ['moodboard', 'review'],
  moodboard: [],
  storyboard: ['shotlist', 'review'],
  // Schedule and Troupe always come with it (decision 0123): nothing to turn on.
  production: [],
};

/** The optional views a new board of this kind starts with: a storyboard has its shot list. */
export const NEW_BOARD_VIEWS: Record<BoardKind, BoardOptionalView[]> = {
  board: [],
  moodboard: [],
  storyboard: ['shotlist'],
  production: [],
};

export const Board = z
  .object({
    id: Id,
    projectId: Id,
    parentBoardId: Id.nullable().openapi({ description: 'Null only for the project root board.' }),
    kind: BoardKind,
    title: z.string().min(1).max(200),
    position: FractionalIndex,
    coverAssetId: Id.nullable(),
    icon: ProjectIcon.nullable()
      .optional()
      .openapi({
        description:
          'Symbol or emoji and colour of the board, picked like the project ones and shown on ' +
          'board cards. Null or omitted = the default board icon.',
      }),
    views: z
      .array(BoardOptionalView)
      .nullable()
      .optional()
      .openapi({
        description:
          'The optional views that are on (decision 0121). Null or omitted on boards from ' +
          'before it: a storyboard then has all of its views, an ordinary board its moodboard ' +
          'when it holds images, links or colours (`referenceCount`) and its review while a ' +
          'guest review link is live (`clientReview`).',
      }),
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
    icon: ProjectIcon.nullable(),
    views: z.array(BoardOptionalView).max(5).openapi({
      description: 'The optional views to turn on; each must be one the board kind allows.',
    }),
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

/** A board whose "Non ordinati" tray holds cards, for the phone Home. */
export const UnsortedBoard = z
  .object({
    boardId: Id,
    projectId: Id,
    boardTitle: z.string(),
    projectName: z.string(),
    count: z.int().positive().openapi({ description: 'Cards directly in the unsorted tray.' }),
    assetIds: z
      .array(Id)
      .max(2)
      .openapi({ description: 'Ready images or videos of those cards, from the same project.' }),
  })
  .openapi('UnsortedBoard');
export type UnsortedBoard = z.infer<typeof UnsortedBoard>;
export const UnsortedSummary = z
  .object({
    items: z.array(UnsortedBoard).max(20),
    total: z
      .int()
      .nonnegative()
      .openapi({ description: 'Cards waiting on all the boards listed.' }),
  })
  .openapi('UnsortedSummary');
export type UnsortedSummary = z.infer<typeof UnsortedSummary>;

/** A line of a frame drawing in a preview, in the frame's STROKE_GRID units (0–4096 both ways). */
const PreviewPath = z.object({
  path: z.string().max(5000),
  color: z.string().regex(/^#[0-9A-F]{6}$/i),
  width: z.number().positive().max(820),
});

/** A shooting day on the card of a Production board (decision 0123). */
const PreviewDay = z.object({
  number: z.int().min(1).openapi({ description: 'Day N: its place among the days, by date.' }),
  date: z.iso.date(),
  callTime: ScheduleTime,
  location: z.string().max(160).openapi({ description: 'The first line of the location.' }),
  blocks: z
    .array(
      z.object({
        start: ScheduleTime.openapi({ description: 'When the block starts, on the clock.' }),
        type: ScheduleBlock.shape.type,
        title: z.string().max(160),
        boardId: Id.nullable().openapi({
          description: 'The storyboard of a shot or scene block (its dot); null for the others.',
        }),
        label: z.string().max(40).nullable().openapi({
          description: 'The frame or scene label as last seen (`shotLabel`, `sceneLabel`).',
        }),
      }),
    )
    .max(5)
    .openapi({ description: 'Its first five blocks.' }),
});

/** Bounded projection of the last persisted document, never a full canvas download. */
export const BoardPreview = z
  .object({
    assetIds: z.array(Id).max(4),
    excerpts: z.array(z.string().max(160)).max(3),
    elementCount: z.int().nonnegative(),
    drawing: z.array(PreviewPath).max(32),
    colors: z
      .array(z.string().regex(/^#[0-9A-F]{6}$/i))
      .max(6)
      .optional()
      .openapi({ description: 'Hex of the first colour cards: the palette of a moodboard.' }),
    frames: z
      .array(
        z.object({
          label: z.string().max(12),
          shot: z.string().max(60).optional().openapi({
            description: 'Shot size as stored: a catalog id or free text.',
          }),
          lens: z.string().max(60).optional(),
          ratio: z.number().positive().max(10).openapi({ description: 'Width over height.' }),
          assetId: Id.optional().openapi({ description: 'Ready picture of the same project.' }),
          drawing: z.array(PreviewPath).max(12),
        }),
      )
      .max(5)
      .optional()
      .openapi({
        description:
          'The first storyboard frames in shooting order (decision 0121, board cards); the ' +
          'first three carry their picture.',
      }),
    review: z
      .object({
        approved: z.int().nonnegative(),
        changes: z.int().nonnegative(),
        total: z.int().nonnegative(),
      })
      .optional()
      .openapi({
        description:
          'Review decisions as the team sees them: frames, or cards when there are none.',
      }),
    dayCount: z.int().nonnegative().optional().openapi({
      description:
        'Shooting days: of a Production board, its own. Of a storyboard (decision 0123), only ' +
        "for members of a project without a live Production board: the project's days that " +
        'adding one would show (on live boards or on the trashed Production board).',
    }),
    crewCount: z.int().nonnegative().optional().openapi({
      description:
        "People of the project's troupe; only for members of the project. On a storyboard, " +
        'only while the project has no live Production board, like `dayCount`.',
    }),
    nextDay: PreviewDay.optional().openapi({
      description:
        'Production board (decision 0123): the next shooting day, the first on or after today ' +
        "in the project's time zone, else the last; absent without days.",
    }),
    crew: z
      .array(z.object({ name: z.string().max(120), role: z.string().max(120) }))
      .max(4)
      .optional()
      .openapi({
        description:
          'Production board: the first people of the troupe in roster order; only for members ' +
          'of the project.',
      }),
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
    cardCount: z.int().nonnegative().optional().openapi({
      description:
        'Cards other than files and boards; arrows, columns, scenes and headings excluded.',
    }),
    fileCount: z.int().nonnegative().optional().openapi({ description: 'File cards.' }),
    boardCount: z.int().nonnegative().optional().openapi({ description: 'Board cards.' }),
    referenceCount: z.int().nonnegative().optional().openapi({
      description: 'Images, links and colours: what a moodboard shows.',
    }),
    looseCount: z
      .int()
      .nonnegative()
      .optional()
      .openapi({
        description:
          'Cards other than scenes, frames and the set plans of a scene; arrows, columns and ' +
          'headings excluded. On a storyboard they are the cards outside the storyboard.',
      }),
    clientReview: z.boolean().optional().openapi({
      description:
        'A share link that lets guests set the review status of cards (`guest_approve`) is live on this board: not revoked, not expired.',
    }),
  })
  .openapi('BoardCount');
export type BoardCount = z.infer<typeof BoardCount>;
export const BoardCounts = z.object({ items: z.array(BoardCount) }).openapi('BoardCounts', {
  description: 'Counts of the project boards the caller can open, for the navigation.',
});
export type BoardCounts = z.infer<typeof BoardCounts>;

/** Personal clip destinations, independent of edits by other people. */
export const ClipBoard = Board.pick({ id: true, projectId: true, title: true, myRole: true })
  .extend({ projectName: z.string(), usedAt: Timestamp })
  .openapi('ClipBoard');
export type ClipBoard = z.infer<typeof ClipBoard>;
export const ClipBoardQuery = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CLIP_BOARD_HISTORY_LIMIT)
      .default(CLIP_BOARD_HISTORY_LIMIT),
  })
  .openapi('ClipBoardQuery');
export const ClipBoards = z
  .object({ items: z.array(ClipBoard).max(CLIP_BOARD_HISTORY_LIMIT) })
  .openapi('ClipBoards');
export type ClipBoards = z.infer<typeof ClipBoards>;
