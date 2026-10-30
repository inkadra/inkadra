// SPDX-License-Identifier: MPL-2.0
import { z } from 'zod';

/**
 * Plain (JSON) view of the elements stored in a board document.
 * In the Y.Doc each element is a Y.Map with these fields; rich text lives in a Y.XmlFragment
 * under `body`, so it is not part of the plain view.
 */

/** Element id: 21 url-safe characters, generated on the client (see newElementId). */
export const ElementId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Parent of the elements waiting in the "Non ordinati" column of a board. */
export const UNSORTED = 'unsorted';

export const MAX_TAGS = 20;
/** A tag as the person typed it; search and filters compare tags without case. */
export const Tag = z.string().trim().min(1).max(40);

/** Aspect ratios offered for storyboards and frames; `2.39` is anamorphic scope. */
export const ASPECT_RATIOS = ['2.39', '1.85', '16:9', '4:3', '3:2', '1:1', '4:5', '9:16'] as const;
export const AspectRatio = z.enum(ASPECT_RATIOS);
export type AspectRatio = z.infer<typeof AspectRatio>;

/** Width divided by height. */
export function aspectValue(ratio: AspectRatio): number {
  if (ratio.includes(':')) {
    const [w, h] = ratio.split(':').map(Number) as [number, number];
    return w / h;
  }
  return Number(ratio);
}

const Base = z.object({
  id: ElementId,
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().finite(),
  h: z.number().nonnegative().finite().optional().describe('Omitted = height follows content.'),
  z: z.string().min(1).describe('Fractional index; higher draws on top.'),
  parent: z
    .string()
    .nullable()
    .describe('Column element id, UNSORTED, or null when placed on the canvas.'),
  locked: z.boolean().optional(),
  tags: z.array(Tag).max(MAX_TAGS).optional().describe('Free labels, used by search and filters.'),
  guestHidden: z
    .boolean()
    .optional()
    .describe(
      'True: left out of what guests of share links see, with everything inside it (a column, ' +
        'a scene) and, for a board card, the board it opens. Omitted = shown. Copies keep the ' +
        'flag of the element itself, not the hiding inherited from a container: a card copied ' +
        'out of a hidden column is shown unless it is hidden too (since version 3).',
    ),
  createdBy: z.string().nullable(),
  createdAt: z.number().int(),
});

export const NoteElement = Base.extend({
  type: z.literal('note'),
  color: z.string().optional(),
});
/** Provenance of a video still. Thumbnail time is a reference, not the pictured instant. */
export const VideoFrameSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('uploaded-video'),
    assetId: z.uuid(),
    timeSeconds: z.number().finite().nonnegative(),
  }),
  z.object({
    kind: z.literal('link-thumbnail'),
    url: z.url({ protocol: /^https?$/ }).max(2048),
    timeSeconds: z.number().finite().nonnegative().optional(),
  }),
]);
export type VideoFrameSource = z.infer<typeof VideoFrameSource>;

export const ImageElement = Base.extend({
  type: z.literal('image'),
  source: VideoFrameSource.optional(),
  assetId: z.string(),
  caption: z.string().max(2000).optional(),
});
export const LinkElement = Base.extend({
  type: z.literal('link'),
  // Web addresses only: the card renders it as a link.
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  imageAssetId: z.string().optional(),
});
export const FileElement = Base.extend({
  type: z.literal('file'),
  assetId: z.string(),
  caption: z.string().max(2000).optional(),
});
export const TodoItem = z.object({ id: ElementId, text: z.string().max(2000), done: z.boolean() });
export const TodoElement = Base.extend({
  type: z.literal('todo'),
  title: z.string().max(200).optional(),
  items: z.array(TodoItem),
});
export const ColorElement = Base.extend({
  type: z.literal('color'),
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  label: z.string().max(80).optional(),
});
export const ColumnElement = Base.extend({
  type: z.literal('column'),
  title: z.string().max(200),
  collapsed: z.boolean().optional(),
});
export const BoardLinkElement = Base.extend({
  type: z.literal('board'),
  boardId: z.uuid(),
});

/**
 * A scene of a storyboard: a container like a column, whose children are frames (and any
 * other card) in shooting order.
 */
export const SceneElement = Base.extend({
  type: z.literal('scene'),
  number: z.string().trim().max(12).describe('Scene number as written in the script, e.g. "4".'),
  title: z.string().max(200),
  setting: z.enum(['int', 'ext', 'int-ext']).optional(),
  time: z.enum(['day', 'night', 'dawn', 'dusk']).optional(),
  location: z.string().max(200).optional(),
  synopsis: z.string().max(2000).optional(),
  collapsed: z.boolean().optional(),
});

/**
 * Preset values for frame fields. A field holds either one of these codes, which clients
 * translate, or text the person typed.
 */
export const SHOT_SIZES = ['ews', 'ws', 'fs', 'ms', 'mcu', 'cu', 'ecu', 'insert'] as const;
export const SHOT_ANGLES = ['eye', 'high', 'low', 'overhead', 'dutch', 'pov', 'ots'] as const;
export const SHOT_MOVEMENTS = [
  'static',
  'pan',
  'tilt',
  'dolly',
  'truck',
  'crane',
  'handheld',
  'steadicam',
  'drone',
  'zoom',
] as const;
export const FRAME_STATUSES = ['draft', 'todo', 'ready', 'shot', 'retake'] as const;
export const FrameStatus = z.enum(FRAME_STATUSES);
export type FrameStatus = z.infer<typeof FrameStatus>;

/**
 * Pen strokes are stored with coordinates relative to the frame picture, quantized to
 * 1/STROKE_GRID of its width and height, so they scale with the card and stay small.
 */
export const STROKE_GRID = 4096;
export const MAX_STROKE_POINTS = 1024;
export const MAX_STROKES = 2000;
const GridCoord = z.int().min(0).max(STROKE_GRID);

export const Stroke = z.object({
  id: ElementId,
  tool: z.enum(['pencil', 'brush', 'marker']),
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  /** Line width in thousandths of the picture width. */
  width: z.int().min(1).max(200),
  opacity: z.number().min(0.05).max(1).optional(),
  /** Flat list x0, y0, x1, y1, … in grid units. */
  points: z
    .array(GridCoord)
    .min(2)
    .max(MAX_STROKE_POINTS * 2)
    .refine((p) => p.length % 2 === 0, 'Points come in x, y pairs.'),
});
export type Stroke = z.infer<typeof Stroke>;

export const MAX_SHAPES = 500;
export const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow', 'text'] as const;

/**
 * A shape or a text of a frame drawing, drawn over the strokes. Coordinates are in STROKE_GRID
 * units like stroke points: the shape spans from (x0, y0) to (x1, y1); a text starts at
 * (x0, y0) and `width` is its font size, in thousandths of the picture width.
 */
export const FrameShape = z.object({
  id: ElementId,
  kind: z.enum(SHAPE_KINDS),
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  width: z.int().min(1).max(200),
  x0: GridCoord,
  y0: GridCoord,
  x1: GridCoord,
  y1: GridCoord,
  text: z.string().max(500).optional(),
});
export type FrameShape = z.infer<typeof FrameShape>;

/**
 * Shapes are read one by one: a shape this client cannot read (a kind added later) is left out
 * instead of making the whole frame invalid.
 */
const FrameShapes = z
  .array(z.unknown())
  .max(MAX_SHAPES)
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = FrameShape.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** A storyboard frame: a picture (drawn or uploaded) with the data of the shot. */
export const FrameElement = Base.extend({
  type: z.literal('frame'),
  source: VideoFrameSource.optional(),
  label: z
    .string()
    .trim()
    .max(12)
    .optional()
    .describe('Shot number shown on the card. Omitted = scene number + letter, from the order.'),
  assetId: z.string().optional().describe('Reference picture under the drawing.'),
  aspect: AspectRatio.optional().describe('Omitted = the aspect ratio of the board.'),
  action: z.string().max(2000).optional().describe('What happens in the shot.'),
  shot: z.string().max(60).optional().describe('Shot size: a SHOT_SIZES code or free text.'),
  angle: z.string().max(60).optional().describe('A SHOT_ANGLES code or free text.'),
  movement: z.string().max(60).optional().describe('A SHOT_MOVEMENTS code or free text.'),
  lens: z.string().max(60).optional().describe('Focal length or lens name, e.g. "35mm".'),
  durationMs: z.int().min(0).max(3_600_000).optional(),
  audio: z.string().max(500).optional(),
  dialogue: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional().describe("Director's notes."),
  location: z.string().max(200).optional(),
  cast: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  status: FrameStatus.optional().describe('Omitted = draft.'),
  approved: z.boolean().optional().describe('Manual approval flag.'),
  strokes: z.array(Stroke).max(MAX_STROKES).optional().describe('Pen drawing, oldest first.'),
  shapes: FrameShapes.optional().describe(
    'Shapes and texts over the strokes, oldest first (since version 4; older clients ignore them).',
  ),
  referenceOpacity: z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe('Opacity of the reference picture under the drawing. Omitted = 1.'),
});

/** One end of an arrow: attached to an element, or a free point on the canvas. */
export const ArrowEnd = z.object({
  elementId: ElementId.optional().describe('Element the end follows while it exists.'),
  x: z.number().finite().describe('Free point, or the last known point of the element.'),
  y: z.number().finite(),
});
export type ArrowEnd = z.infer<typeof ArrowEnd>;

/**
 * An arrow between two cards or points. `x`, `y`, `w` and `h` hold its bounding box at the
 * last edit, for culling and marquee selection; renderers draw it from `from` and `to`.
 */
export const ArrowElement = Base.extend({
  type: z.literal('arrow'),
  from: ArrowEnd,
  to: ArrowEnd,
  label: z.string().max(200).optional(),
  line: z.enum(['solid', 'dashed']).optional(),
  heads: z.enum(['end', 'both', 'none']).optional().describe('Omitted = end.'),
});

export const Element = z.discriminatedUnion('type', [
  NoteElement,
  ImageElement,
  LinkElement,
  FileElement,
  TodoElement,
  ColorElement,
  ColumnElement,
  BoardLinkElement,
  SceneElement,
  FrameElement,
  ArrowElement,
]);

/** Element types that hold other elements through `parent`. */
export const CONTAINER_TYPES = ['column', 'scene'] as const satisfies readonly ElementType[];
export type Element = z.infer<typeof Element>;
export type ElementType = Element['type'];

export const ELEMENT_TYPES = Element.options.map((o) => o.shape.type.value) as ElementType[];
