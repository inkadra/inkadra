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

/** Aspect presets offered when cropping an image card. */
export const IMAGE_CROP_ASPECTS = ['free', '1:1', '4:3', '16:9', '2.39:1'] as const;
export const ImageCropAspect = z.enum(IMAGE_CROP_ASPECTS);
export type ImageCropAspect = z.infer<typeof ImageCropAspect>;

/**
 * Non-destructive crop rectangle in normalized [0, 1] coordinates of the rotated image
 * bounding box.
 */
export const ImageCrop = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    w: z.number().finite().positive().max(1),
    h: z.number().finite().positive().max(1),
    aspect: ImageCropAspect.optional(),
  })
  .refine((c) => c.x + c.w <= 1 + 1e-6 && c.y + c.h <= 1 + 1e-6, {
    message: 'Crop rectangle must stay within the [0, 1] image bounds.',
  });
export type ImageCrop = z.infer<typeof ImageCrop>;

export const ImageElement = Base.extend({
  type: z.literal('image'),
  source: VideoFrameSource.optional(),
  assetId: z.string(),
  caption: z.string().max(2000).optional(),
  crop: ImageCrop.optional().describe(
    'Non-destructive crop rectangle in normalized [0, 1] coordinates of the rotated image (since version 8).',
  ),
  rotation: z
    .number()
    .finite()
    .min(-360)
    .max(360)
    .optional()
    .describe(
      'Clockwise rotation in degrees (90° steps or free angle; omitted or 0 = unrotated, since version 8).',
    ),
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
export const TodoItem = z.object({
  id: ElementId,
  text: z.string().max(2000),
  done: z.boolean(),
  assigneeId: z.uuid().optional(),
  dueDate: z.iso.date().optional(),
});
/** What a to-do list gathers for the shoot: wardrobe, props or equipment (decision 0058). */
export const TODO_LISTS = ['wardrobe', 'props', 'equipment'] as const;
export const TodoList = z.enum(TODO_LISTS);
export type TodoList = z.infer<typeof TodoList>;
export const TodoElement = Base.extend({
  type: z.literal('todo'),
  title: z.string().max(200).optional(),
  items: z.array(TodoItem),
  list: TodoList.optional().describe(
    'Kind of things the list gathers for the shoot. Omitted = an ordinary to-do (since version 13).',
  ),
  sceneId: ElementId.optional().describe(
    'Scene of the same board the items are needed for; shooting days that shoot it list them ' +
      '(since version 13).',
  ),
});
export const ColorElement = Base.extend({
  type: z.literal('color'),
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  label: z.string().max(80).optional(),
});
/** The card palette: tints of notes and accents of columns (decision 0033). */
export const CARD_COLORS = ['blue', 'orange', 'purple', 'green'] as const;
export const CardColor = z.enum(CARD_COLORS);
export type CardColor = z.infer<typeof CardColor>;

export const ColumnElement = Base.extend({
  type: z.literal('column'),
  title: z.string().max(200),
  collapsed: z.boolean().optional(),
  color: CardColor.optional().describe(
    'Accent from the card palette: a bar on the title and a light tint of the header. Omitted = none (since version 10).',
  ),
});
export const BoardLinkElement = Base.extend({
  type: z.literal('board'),
  boardId: z.uuid(),
});

/**
 * A section heading: one line of large text with a rule under it, no card chrome, resizable in
 * width only (since version 10). With `moveCards`, dragging it also moves the cards placed under
 * it (see sectionMembers in canvas-core).
 */
export const SectionElement = Base.extend({
  type: z.literal('section'),
  title: z.string().max(200),
  moveCards: z
    .boolean()
    .optional()
    .describe('True: dragging the heading moves the cards under it too. Omitted = alone.'),
});

/** Limits of a table card: a planning grid on the board, not a spreadsheet. */
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_ROWS = 500;
export const MAX_TABLE_CELL = 2000;

export const TableColumn = z.object({
  id: ElementId,
  width: z
    .number()
    .int()
    .min(40)
    .max(1200)
    .optional()
    .describe('Width in world units. Omitted = the columns share what the card leaves.'),
});
export type TableColumn = z.infer<typeof TableColumn>;

export const TableRow = z.object({
  id: ElementId,
  cells: z
    .record(z.string(), z.string().max(MAX_TABLE_CELL))
    .describe('Plain text by column id; a missing key is an empty cell.'),
});
export type TableRow = z.infer<typeof TableRow>;

/**
 * A table card (since version 11, decision 0052): plain-text cells, links detected when shown.
 * Columns and rows are Y.Arrays of Y.Maps and the cells of a row a Y.Map, so people editing
 * different cells, or adding rows, merge.
 */
export const TableElement = Base.extend({
  type: z.literal('table'),
  columns: z.array(TableColumn).min(1).max(MAX_TABLE_COLUMNS),
  rows: z.array(TableRow).max(MAX_TABLE_ROWS),
  header: z.boolean().optional().describe('True: the first row is a header row.'),
  color: CardColor.optional().describe('Tint of the header row, from the card palette.'),
});

/**
 * A map card (since version 11, decision 0053): a place from a map link or an address, with
 * a map picture the server composited once, so viewers never contact a tile server.
 */
export const MapElement = Base.extend({
  type: z.literal('map'),
  name: z.string().max(200).describe('Place name, from the link or typed; may be empty.'),
  address: z.string().max(500).optional(),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional()
    .describe('The map link it came from, opened by "Open in Maps".'),
  lat: z.number().finite().min(-90).max(90).optional(),
  lon: z.number().finite().min(-180).max(180).optional(),
  zoom: z.int().min(1).max(19).optional(),
  imageAssetId: z.string().optional().describe('The map picture, centred on the place.'),
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

/** Width divided by height of a set plan's drawing; its coordinates are STROKE_GRID units of it. */
export const PLAN_ASPECT = 3 / 2;
export const MAX_PLAN_ICONS = 300;
/**
 * The set icons of a plan, by category (decision 0062): lights, grip, camera and movement,
 * people, audio and video, furniture, exteriors. `light` is the light of version 14 plans,
 * drawn as a Fresnel. Generic types only, no makes or models.
 */
export const PLAN_ICON_KINDS = [
  'fresnel',
  'led',
  'tube',
  'softbox',
  'lantern',
  'para',
  'practical',
  'sun',
  'cstand',
  'flag',
  'frame',
  'bounce',
  'gel',
  'camera',
  'tripod',
  'gimbal',
  'dolly',
  'track',
  'slider',
  'jib',
  'drone',
  'carrig',
  'actor',
  'group',
  'crew',
  'boom',
  'monitor',
  'recorder',
  'table',
  'chair',
  'sofa',
  'bed',
  'wardrobe',
  'desk',
  'stairs',
  'door',
  'window',
  'wall',
  'column',
  'tree',
  'car',
  'road',
  'light',
] as const;
export type PlanIconKind = (typeof PLAN_ICON_KINDS)[number];

/** Layers of a plan; each item belongs to one (since version 15). */
export const PLAN_LAYERS = ['set', 'lights', 'camera', 'actors', 'notes'] as const;
export const PlanLayer = z.enum(PLAN_LAYERS);
export type PlanLayer = z.infer<typeof PlanLayer>;

/** The layer each icon kind goes to without one of its own (decision 0062). */
const LAYER_OF_KIND: Record<string, PlanLayer> = {
  ...Object.fromEntries(
    ['fresnel', 'led', 'tube', 'softbox', 'lantern', 'para', 'practical', 'sun', 'light'].map(
      (k) => [k, 'lights'],
    ),
  ),
  ...Object.fromEntries(['cstand', 'flag', 'frame', 'bounce', 'gel'].map((k) => [k, 'lights'])),
  ...Object.fromEntries(
    [
      'camera',
      'tripod',
      'gimbal',
      'dolly',
      'track',
      'slider',
      'jib',
      'drone',
      'carrig',
      'boom',
      'monitor',
      'recorder',
    ].map((k) => [k, 'camera']),
  ),
  ...Object.fromEntries(['actor', 'group', 'crew'].map((k) => [k, 'actors'])),
};

/**
 * The layer a plan item is on: its own, else its kind's (furniture and walls on Set, texts and
 * measures on Notes, strokes and other shapes on Set).
 */
export function planItemLayer(item: {
  layer?: PlanLayer | undefined;
  kind?: string;
  x?: number;
}): PlanLayer {
  if (item.layer) return item.layer;
  if (item.kind !== undefined && item.x !== undefined) return LAYER_OF_KIND[item.kind] ?? 'set';
  return item.kind === 'measure' || item.kind === 'text' ? 'notes' : 'set';
}

/** Plain extras every plan item may carry (since version 15). */
const PlanItemExtras = {
  layer: PlanLayer.optional().describe("Omitted = the layer of the item's family."),
  group: ElementId.optional().describe('Items with the same group move together; one level.'),
};

/** A position an icon moved through, in blocking (since version 15). */
export const PlanStep = z.object({
  x: GridCoord,
  y: GridCoord,
  rotation: z.int().min(0).max(359).optional(),
  note: z.string().max(200).optional().describe('"Porta, entra".'),
  bend: z
    .number()
    .finite()
    .min(-1000)
    .max(1000)
    .optional()
    .describe('Bow of the move from here to the next position, in view units; omitted = straight.'),
});
export type PlanStep = z.infer<typeof PlanStep>;

/**
 * A set icon of a plan, centred on (x, y) in STROKE_GRID units of the drawing. `rotation` turns
 * it clockwise from facing right: a camera looks, a light shines and an actor faces that way.
 * The rest is optional and since version 15: size, lens and beam, blocking, layer and group.
 */
export const PlanIcon = z.object({
  id: ElementId,
  kind: z.enum(PLAN_ICON_KINDS),
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  x: GridCoord,
  y: GridCoord,
  rotation: z.int().min(0).max(359).optional().describe('Degrees clockwise. Omitted = 0.'),
  label: z.string().max(60).optional().describe('"A cam", "Anna", "Key 1,2K".'),
  size: z.enum(['S', 'L']).optional().describe('Symbols: small or large. Omitted = medium.'),
  w: z.number().positive().max(4000).optional().describe('Furniture: width in view units.'),
  h: z.number().positive().max(4000).optional().describe('Furniture: depth in view units.'),
  lens: z.int().min(4).max(2000).optional().describe('Camera: focal length in mm. Omitted = 35.'),
  showLens: z.boolean().optional().describe('Camera: the lens after the label.'),
  reach: z
    .number()
    .positive()
    .max(4000)
    .optional()
    .describe('Length of the view cone or beam, in view units. Omitted = the default.'),
  power: z.string().max(20).optional().describe('Light: "1,2K", "300 W".'),
  beam: z.int().min(5).max(180).optional().describe('Light: beam angle in degrees.'),
  intensity: z.number().min(0).max(1).optional().describe('Light: 0 to 1, how dense its beam is.'),
  steps: z
    .array(PlanStep)
    .max(30)
    .optional()
    .describe('Blocking: the earlier positions, first first; the icon stands at the last one.'),
  note: z.string().max(200).optional().describe('Blocking: what happens at the last position.'),
  dashed: z.boolean().optional().describe('Blocking: moves drawn dashed (the camera, say).'),
  ...PlanItemExtras,
});
export type PlanIcon = z.infer<typeof PlanIcon>;

/**
 * Items of a plan read one by one, like frame shapes: an item this build cannot read (a kind
 * added later) is left out, and items past the limit are cut instead of failing the whole card,
 * so two people adding at the limit at once never make the plan disappear.
 */
function lenientList<T extends z.ZodType>(item: T, max: number) {
  return z.array(z.unknown()).transform((items) =>
    items
      .flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      })
      .slice(0, max),
  );
}

const PlanIcons = lenientList(PlanIcon, MAX_PLAN_ICONS);

/** A pen stroke of a plan: a frame stroke with a layer and a group. */
export const PlanStroke = Stroke.extend(PlanItemExtras);
export type PlanStroke = z.infer<typeof PlanStroke>;

/**
 * A shape of a plan: a frame shape that may also be a measure (a dimension line, its ends
 * attached to icons by `from` and `to`) or a zone (a dashed area), turned by `rotation` around
 * its middle (since version 15).
 */
export const PlanShape = FrameShape.extend({
  kind: z.enum([...SHAPE_KINDS, 'measure', 'zone']),
  rotation: z.int().min(0).max(359).optional(),
  dashed: z.boolean().optional(),
  from: ElementId.optional().describe('Measure: icon its start follows.'),
  to: ElementId.optional().describe('Measure: icon its end follows.'),
  ...PlanItemExtras,
});
export type PlanShape = z.infer<typeof PlanShape>;

const PlanShapes = lenientList(PlanShape, MAX_SHAPES);
const PlanStrokes = lenientList(PlanStroke, MAX_STROKES);

/** Sensor formats for a camera's angle of view; widths in mm. */
export const PLAN_SENSORS = { s35: 24.89, ff: 36, m43: 17.3, s16: 12.52 } as const;
export type PlanSensor = keyof typeof PLAN_SENSORS;

/**
 * A set plan (since version 14, decision 0062): a lighting or blocking diagram drawn with the
 * frame drawing's strokes and shapes, plus set icons, over a drawing PLAN_ASPECT wide per unit
 * of height. Strokes and shapes are plain objects in Y.Arrays, as on frames; icons are Y.Maps
 * in a Y.Array, so two people moving and labelling different icons merge. Version 15 adds the
 * scenes it serves, variants sharing a base's Set layer, layers, a real scale and the output
 * options.
 */
export const PlanElement = Base.extend({
  type: z.literal('plan'),
  title: z.string().max(200).optional().describe('Shown after "Set plan" in the header.'),
  strokes: PlanStrokes.optional().describe('Pen drawing, oldest first.'),
  shapes: PlanShapes.optional().describe('Shapes and texts over the strokes, oldest first.'),
  icons: PlanIcons.optional().describe('Set icons over the shapes, oldest first.'),
  sceneIds: z
    .array(ElementId)
    .max(50)
    .optional()
    .describe('Scenes of the same board the plan serves.'),
  variantOf: ElementId.optional().describe(
    'Base plan whose Set layer this variant shows and edits; its own Set layer stays empty.',
  ),
  variant: z.string().max(60).optional().describe('Name of the variant: "Giorno", "Sera".'),
  hiddenLayers: z
    .array(PlanLayer)
    .max(5)
    .optional()
    .describe('Left out on the card and in exports.'),
  lockedLayers: z.array(PlanLayer).max(5).optional().describe('Not moved or edited.'),
  scale: z
    .number()
    .positive()
    .max(100000)
    .optional()
    .describe('View units per metre; omitted = no real scale, no metres.'),
  grid: z.enum(['0.25', '0.5', '1']).optional().describe('Grid step in metres, with a scale.'),
  rulers: z.boolean().optional(),
  sensor: z.enum(['s35', 'ff', 'm43', 's16']).optional().describe('Omitted = Super 35.'),
  presentation: z.boolean().optional().describe('False: left out of the scene slides.'),
});
export type PlanElementSchema = z.infer<typeof PlanElement>;

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
  path: z
    .enum(['straight', 'curved'])
    .optional()
    .describe(
      'Omitted = straight. A curved arrow bows to the left of the line from `from` to `to`, ' +
        'by a share of its length that renderers fix (since version 6).',
    ),
});

/** Scene numbers as written in the script ("4", "12A"): scenes live on other boards. */
const SceneNumbers = z
  .array(z.string().trim().min(1).max(12))
  .max(200)
  .optional()
  .describe('Scene numbers as written in the script, e.g. "4" or "12A" (since version 7).');

/**
 * A character of the story bible: a structured card whose face shows the name, the role and
 * the picture; the rest is read and edited in the card's side sheet (decision 0044).
 */
export const CharacterElement = Base.extend({
  type: z.literal('character'),
  name: z.string().max(120),
  role: z.string().max(200).optional().describe('Role in the story, e.g. "protagonist".'),
  assetId: z.string().optional().describe('Photo or reference picture.'),
  age: z.string().max(40).optional().describe('As written: "34", "about 60", "teen".'),
  description: z.string().max(4000).optional(),
  actor: z.string().max(120).optional().describe('Who plays the character.'),
  contact: z.string().max(500).optional().describe('Agent, phone or e-mail; never for guests.'),
  notes: z.string().max(4000).optional().describe('Internal casting notes; never for guests.'),
  scenes: SceneNumbers,
});

/** A shooting location of the story bible (decision 0044). */
export const LocationElement = Base.extend({
  type: z.literal('location'),
  name: z.string().max(200),
  setting: z.enum(['int', 'ext', 'int-ext']).optional(),
  address: z.string().max(500).optional(),
  mapUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional()
    .describe('A link to any map service, opened in a new tab; never embedded.'),
  assetId: z.string().optional().describe('Photo of the place.'),
  light: z.string().max(1000).optional().describe('Best time of day and light notes.'),
  availability: z.string().max(1000).optional(),
  contact: z.string().max(500).optional().describe('Owner or manager; never for guests.'),
  notes: z.string().max(4000).optional().describe('Internal notes; never for guests.'),
  scenes: SceneNumbers,
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
  CharacterElement,
  LocationElement,
  SectionElement,
  TableElement,
  MapElement,
  PlanElement,
]);

/** Element types that hold other elements through `parent`. */
export const CONTAINER_TYPES = ['column', 'scene'] as const satisfies readonly ElementType[];
export type Element = z.infer<typeof Element>;
export type ElementType = Element['type'];

export const ELEMENT_TYPES = Element.options.map((o) => o.shape.type.value) as ElementType[];

/** What a board or a column holds, for the counts under their titles and in the navigation. */
export interface ContentCounts {
  elementCount: number;
  frameCount: number;
  /** Frames whose status is not `shot` yet. */
  framesToShoot: number;
  /** Board cards. */
  boardCount: number;
  /** File cards. */
  fileCount: number;
  /** Every other card; arrows, columns, scenes and section headings only arrange cards. */
  cardCount: number;
}

const STRUCTURE: ReadonlySet<unknown> = new Set(['arrow', 'column', 'scene', 'section']);

/** Counts elements by what they are; takes plain elements or the fields read from Y.Maps. */
export function contentCounts(
  items: Iterable<{ type?: unknown; status?: unknown }>,
): ContentCounts {
  const counts: ContentCounts = {
    elementCount: 0,
    frameCount: 0,
    framesToShoot: 0,
    boardCount: 0,
    fileCount: 0,
    cardCount: 0,
  };
  for (const { type, status } of items) {
    counts.elementCount++;
    if (type === 'board') counts.boardCount++;
    else if (type === 'file') counts.fileCount++;
    else if (!STRUCTURE.has(type)) counts.cardCount++;
    if (type !== 'frame') continue;
    counts.frameCount++;
    if (status !== 'shot') counts.framesToShoot++;
  }
  return counts;
}
