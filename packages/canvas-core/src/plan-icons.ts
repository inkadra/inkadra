// SPDX-License-Identifier: MPL-2.0
import { type PlanIconKind, type PlanLayer, planItemLayer } from '@inkadra/doc-schema';
import { CATALOGUE_GLYPHS } from './plan-glyphs.ts';

/**
 * The set icons of a plan (decisions 0062 and 0104): 163 glyphs seen from above, facing right,
 * centred on 0,0 in a -20..20 box, with one stroke weight; the same drawing in the library, on
 * the plan and in the exports. And what each kind is: its category and group, the colour family
 * it starts in, its stacking tier, whether it takes a free size, its size when dropped, and what
 * it attaches to.
 */

/**
 * A part of a glyph: a path (`d`), a circle (`c`: cx, cy, r), an ellipse (`e`: cx, cy, rx, ry) or
 * a rectangle (`r`: x, y, w, h, rx). Strokes are DEFAULT_GLYPH_STROKE wide unless `w`, dashed by
 * `dash`, at `o` opacity, with butt ends when `butt`. Fills: `mix` is opaque, the icon's colour
 * mixed that far into the paper (what is under it is hidden); `alpha` is see-through, the colour
 * at that opacity (an overhead frame, a tent, a tripod's footprint, a prompter's glass); `hole`
 * is the paper. `color` is a palette colour of its own instead of the icon's (a gel's orange).
 */
export interface GlyphPart {
  d?: string;
  c?: number[];
  e?: number[];
  r?: number[];
  w?: number;
  dash?: number[];
  o?: number;
  butt?: boolean;
  mix?: number;
  alpha?: number;
  hole?: boolean;
  color?: string;
}

/** Stroke width of a glyph, in glyph units (its box is 40 wide). */
export const DEFAULT_GLYPH_STROKE = 1.7;

export const GLYPHS = {
  ...CATALOGUE_GLYPHS,
  // Annotation tools, listed with the icons; they draw shapes, not icons.
  arrow: [{ d: 'M-12 9C-8-4 0-8 11-8' }, { d: 'M5-13l6 5-5 6' }],
  text: [{ d: 'M-9-10h18M0-10v20M-4 10h8' }],
  measure: [
    { d: 'M-14 0h28M-14-5v10M14-5v10' },
    { d: 'M-9 0l3-3M-9 0l3 3M9 0l-3-3M9 0l-3 3', w: 1 },
  ],
  zone: [
    { d: 'M-12-10l22-2 4 18-21 6z', dash: [3, 2.5] },
    { d: 'M-5-1h10', w: 1 },
  ],
} satisfies Record<string, GlyphPart[]>;
export type GlyphName = keyof typeof GLYPHS;

/** The colour family an icon starts in: lights yellow, cameras blue, video and sound teal, people
 * purple, the rest ink. */
export type PlanFamily = 'light' | 'camera' | 'video' | 'person' | 'ink';

/**
 * Stacking, bottom to top (decision 0104): 0 background, floor and walls; 1 furniture, props and
 * vehicles; 2 stands, supports and track; 3 lights, camera and grip; 4 people; 5 labels, measures
 * and notes. An item's `tier` (Bring forward, Send back) overrides its kind's.
 */
export const PLAN_TIERS = {
  set: 0,
  furniture: 1,
  support: 2,
  kit: 3,
  people: 4,
  notes: 5,
} as const;
export type PlanTier = (typeof PLAN_TIERS)[keyof typeof PLAN_TIERS];

export type PlanGroupId =
  | 'hard'
  | 'soft'
  | 'large'
  | 'natural'
  | 'modifiers'
  | 'cut'
  | 'diffuse'
  | 'stands'
  | 'power'
  | 'camera'
  | 'video'
  | 'people'
  | 'set'
  | 'furniture'
  | 'exterior';

/** A group of the library, under a category of its rail. */
export interface PlanGroup {
  id: PlanGroupId;
  family: PlanFamily;
  tier: PlanTier;
  /** Takes a free width and depth (furniture, the set, exteriors); the others scale as symbols. */
  sized: boolean;
  kinds: readonly PlanIconKind[];
}

/** A category of the library's rail and the groups it shows. */
export interface PlanCategory {
  id: 'lights' | 'grip' | 'camera' | 'people' | 'set' | 'av';
  family: PlanFamily;
  groups: readonly PlanGroup[];
  /** Every kind of its groups, in order. */
  kinds: readonly PlanIconKind[];
}

const T = PLAN_TIERS;
const group = (
  id: PlanGroupId,
  family: PlanFamily,
  tier: PlanTier,
  kinds: readonly PlanIconKind[],
  sized = false,
): PlanGroup => ({ id, family, tier, sized, kinds });
const category = (
  id: PlanCategory['id'],
  family: PlanFamily,
  groups: PlanGroup[],
): PlanCategory => ({
  id,
  family,
  groups,
  kinds: groups.flatMap((g) => g.kinds),
});

/** The library, in its order: 6 categories, 15 groups, 163 kinds (decision 0104). */
export const PLAN_CATEGORIES: readonly PlanCategory[] = [
  category('lights', 'light', [
    group('hard', 'light', T.kit, [
      'fresnel',
      'openface',
      'par',
      'dedo',
      'leko',
      'hmi',
      'molebeam',
      'followspot',
    ]),
    group('soft', 'light', T.kit, [
      'led',
      'cob',
      'flex',
      'tube',
      'kino',
      'lantern',
      'space',
      'softlight',
      'ring',
      'bulb',
    ]),
    group('large', 'light', T.kit, ['skypan', 'array', 'cyc', 'balloon', 'coop', 'wendy']),
    group('natural', 'light', T.kit, [
      'sun',
      'moon',
      'practical',
      'pendant',
      'floorlamp',
      'candle',
      'fire',
      'screen',
      'neon',
      'headlights',
      'streetlight',
    ]),
  ]),
  category('grip', 'ink', [
    group('modifiers', 'ink', T.kit, [
      'softbox',
      'octa',
      'para',
      'grid',
      'barn',
      'snoot',
      'gel',
      'scrim',
      'gobo',
    ]),
    group('cut', 'ink', T.kit, [
      'flag',
      'floppy',
      'cutter',
      'net',
      'dot',
      'cuco',
      'branch',
      'drape',
    ]),
    group('diffuse', 'ink', T.kit, [
      'frame',
      'butterfly',
      'bounce',
      'vflat',
      'reflector',
      'mirror',
    ]),
    group('stands', 'ink', T.support, [
      'cstand',
      'combo',
      'lightstand',
      'roller',
      'boomarm',
      'polecat',
      'rig',
      'goalpost',
      'clamp',
      'sandbag',
      'applebox',
      'ladder',
      'cart',
    ]),
    group('power', 'ink', T.kit, [
      'genny',
      'distro',
      'dimmer',
      'cable',
      'battery',
      'haze',
      'fan',
      'rain',
      'snow',
    ]),
  ]),
  category('camera', 'camera', [
    group('camera', 'camera', T.kit, [
      'camera',
      'tripod',
      'hihat',
      'shoulder',
      'gimbal',
      'steadi',
      'slider',
      'dolly',
      'track',
      'curve',
      'jib',
      'techno',
      'drone',
      'carrig',
      'trackingcar',
    ]),
  ]),
  category('people', 'person', [
    group('people', 'person', T.people, [
      'actor',
      'support',
      'extra',
      'group',
      'seated',
      'lying',
      'child',
      'stunt',
      'mark',
      'animal',
    ]),
  ]),
  category('set', 'ink', [
    group(
      'set',
      'ink',
      T.set,
      [
        'wall',
        'door',
        'doubledoor',
        'sliding',
        'window',
        'arch',
        'column',
        'stairs',
        'platform',
        'backdrop',
        'curtain',
        'flat',
      ],
      true,
    ),
    group(
      'furniture',
      'ink',
      T.furniture,
      [
        'table',
        'roundtable',
        'desk',
        'chair',
        'armchair',
        'sofa',
        'stool',
        'bench',
        'bed',
        'wardrobe',
        'shelf',
        'counter',
        'kitchen',
        'fridge',
        'sink',
        'bathtub',
        'toilet',
        'tv',
        'piano',
        'rug',
        'plant',
      ],
      true,
    ),
    group(
      'exterior',
      'ink',
      T.furniture,
      ['car', 'truck', 'moto', 'bike', 'road', 'tree', 'bush', 'fence', 'water', 'cone', 'barrier'],
      true,
    ),
  ]),
  category('av', 'video', [
    group('video', 'video', T.kit, [
      'village',
      'monitor',
      'dit',
      'boom',
      'soundcart',
      'plantmic',
      'speaker',
      'prompter',
      'crew',
      'dirchair',
      'hmu',
      'rack',
      'crafty',
      'tent',
    ]),
  ]),
];

/** Annotation tools listed with the icons; they draw shapes, not icons. */
export const PLAN_NOTE_TOOLS = ['arrow', 'text', 'measure', 'zone'] as const;
export type PlanNoteTool = (typeof PLAN_NOTE_TOOLS)[number];

/** Kinds of earlier versions and the kind each is drawn and counted as (decision 0104). */
export const LEGACY_KINDS: Readonly<Partial<Record<PlanIconKind, PlanIconKind>>> = {
  light: 'fresnel',
  recorder: 'soundcart',
};

const CATEGORY_OF = new Map<PlanIconKind, PlanCategory>();
const GROUP_OF = new Map<PlanIconKind, PlanGroup>();
for (const c of PLAN_CATEGORIES)
  for (const g of c.groups)
    for (const k of g.kinds) {
      CATEGORY_OF.set(k, c);
      GROUP_OF.set(k, g);
    }

/** The kind an icon is drawn and counted as: itself, or what an older kind became. */
export function catalogueKind(kind: PlanIconKind): PlanIconKind {
  return LEGACY_KINDS[kind] ?? kind;
}

export function categoryOf(kind: PlanIconKind): PlanCategory {
  return CATEGORY_OF.get(catalogueKind(kind)) ?? (PLAN_CATEGORIES[0] as PlanCategory);
}

export function groupOf(kind: PlanIconKind): PlanGroup {
  return GROUP_OF.get(catalogueKind(kind)) ?? (PLAN_CATEGORIES[0]?.groups[0] as PlanGroup);
}

/** The layer an icon of this kind goes to without one of its own (one table, in doc-schema). */
export function kindLayer(kind: PlanIconKind): PlanLayer {
  return planItemLayer({ kind, x: 0 });
}

/** The stacking tier of a kind (PLAN_TIERS); supports of the camera group sit under the camera. */
export function kindTier(kind: PlanIconKind): PlanTier {
  const k = catalogueKind(kind);
  if (SUPPORT_TIER.has(k)) return T.support;
  if (FURNITURE_TIER.has(k)) return T.furniture;
  if (k === 'rug' || k === 'road' || k === 'water') return T.set;
  if (k === 'crew' || k === 'boom') return T.people;
  return groupOf(k).tier;
}
const SUPPORT_TIER: ReadonlySet<PlanIconKind> = new Set([
  'tripod',
  'hihat',
  'slider',
  'dolly',
  'track',
  'curve',
  'jib',
  'techno',
  'carrig',
  'trackingcar',
  'cable',
  'genny',
  'distro',
  'dimmer',
  'battery',
]);
const FURNITURE_TIER: ReadonlySet<PlanIconKind> = new Set([
  'dirchair',
  'hmu',
  'rack',
  'crafty',
  'tent',
  'village',
  'dit',
  'soundcart',
]);

/**
 * Kinds that take a free width and depth: the set, furniture, exteriors, and the kit whose length
 * is what the crew needs ("Binario 3 m", "Diffusore 1,2 m").
 */
const SIZED_KIT: ReadonlySet<PlanIconKind> = new Set([
  'track',
  'curve',
  'frame',
  'butterfly',
  'rig',
  'cable',
  'tent',
]);
export function isSized(kind: PlanIconKind): boolean {
  const k = catalogueKind(kind);
  return groupOf(k).sized || SIZED_KIT.has(k);
}

/** The glyph of a kind, or of an annotation tool. */
export function glyphOf(kind: PlanIconKind | PlanNoteTool): GlyphPart[] {
  const k = kind in LEGACY_KINDS ? catalogueKind(kind as PlanIconKind) : kind;
  return GLYPHS[k as GlyphName];
}

/**
 * The glyph an icon is drawn with: its kind's, except people posed seated or lying, who take
 * those glyphs.
 */
export function iconGlyph(icon: {
  kind: PlanIconKind;
  pose?: 'standing' | 'seated' | 'lying' | undefined;
}): GlyphPart[] {
  if (icon.pose && icon.pose !== 'standing' && POSED.has(icon.kind)) return GLYPHS[icon.pose];
  return glyphOf(icon.kind);
}
const POSED: ReadonlySet<PlanIconKind> = new Set(['actor', 'support', 'extra', 'stunt', 'child']);

/** Lights whose light falls in a beam from their front; cameras have a view cone instead. */
export const BEAM_KINDS: ReadonlySet<PlanIconKind> = new Set([
  'light',
  'fresnel',
  'openface',
  'par',
  'dedo',
  'leko',
  'hmi',
  'molebeam',
  'followspot',
  'led',
  'cob',
  'flex',
  'tube',
  'kino',
  'softlight',
  'ring',
  'skypan',
  'array',
  'cyc',
  'wendy',
  'sun',
  'moon',
  'screen',
  'headlights',
  // Lights of version 15 that are modifiers now: a free one keeps its beam (decision 0104).
  'softbox',
  'para',
]);

/** Lights that glow all around them: lanterns, bulbs, practicals, fire. */
export const GLOW_KINDS: ReadonlySet<PlanIconKind> = new Set([
  'lantern',
  'space',
  'bulb',
  'balloon',
  'coop',
  'practical',
  'pendant',
  'floorlamp',
  'candle',
  'fire',
  'neon',
  'streetlight',
]);

/** Kinds that are lights: they carry the light's fields and their watts count as power. */
export function isLight(kind: PlanIconKind): boolean {
  return categoryOf(kind).id === 'lights';
}

/**
 * Angle each glyph faces in its drawing, in degrees clockwise from right: an icon's `rotation` is
 * where it faces, so the glyph turns by the difference. Every glyph of the catalogue faces right.
 */
export const GLYPH_FACING: Partial<Record<PlanIconKind, number>> = {};

// Sizes when dropped ---------------------------------------------------------------

/**
 * View units per metre on a plan without a scale: a person (0.5 m) is a medium symbol, as before,
 * and the rest keep their proportions to it.
 */
export const NOMINAL_SCALE = 88;

/**
 * Real size of each kind when dropped (decision 0104, "Snap" in the mockup): the long side of a
 * symbol in metres, or the long and short sides of a sized kind, laid along the glyph's long and
 * short axes. Everything stays freely resizable.
 */
export const DEFAULT_METRES: Readonly<Record<PlanIconKind, number | readonly [number, number]>> = {
  fresnel: 0.5,
  openface: 0.4,
  par: 0.4,
  dedo: 0.25,
  leko: 0.6,
  hmi: 0.7,
  molebeam: 0.8,
  followspot: 1,
  led: 0.6,
  cob: 0.4,
  flex: 0.6,
  tube: 1.2,
  kino: 0.8,
  lantern: 0.8,
  space: 1,
  softlight: 0.6,
  ring: 0.5,
  bulb: 0.15,
  skypan: 1,
  array: 1.2,
  cyc: 1.2,
  balloon: 2,
  coop: 1.5,
  wendy: 2,
  sun: 1,
  moon: 1,
  practical: 0.4,
  pendant: 0.5,
  floorlamp: 0.5,
  candle: 0.15,
  fire: 1,
  screen: 0.6,
  neon: 1,
  headlights: 1.8,
  streetlight: 1,
  softbox: 0.9,
  octa: 1.2,
  para: 1.2,
  grid: 0.9,
  barn: 0.4,
  snoot: 0.3,
  gel: 0.4,
  scrim: 0.4,
  gobo: 0.3,
  flag: 1.2,
  floppy: 1.2,
  cutter: 1.2,
  net: 1.2,
  dot: 0.3,
  cuco: 1.2,
  branch: 1.5,
  drape: 2,
  frame: [1.8, 0.2],
  butterfly: [3.6, 3.6],
  bounce: 1.2,
  vflat: 2.4,
  reflector: 1,
  mirror: 1,
  cstand: 0.9,
  combo: 1.2,
  lightstand: 0.9,
  roller: 1.2,
  boomarm: 1.5,
  polecat: 3,
  rig: [3, 0.3],
  goalpost: 3,
  clamp: 0.15,
  sandbag: 0.4,
  applebox: 0.5,
  ladder: 1.5,
  cart: 1.5,
  genny: 2,
  distro: 0.6,
  dimmer: 0.8,
  cable: [3, 0.2],
  battery: 0.3,
  haze: 0.5,
  fan: 1,
  rain: 2,
  snow: 2,
  camera: 0.5,
  tripod: 1,
  hihat: 0.4,
  shoulder: 0.6,
  gimbal: 0.6,
  steadi: 0.8,
  slider: 1,
  dolly: 1.2,
  track: [1.5, 0.6],
  curve: [1.5, 1.5],
  jib: 3,
  techno: 4,
  drone: 0.5,
  carrig: 1,
  trackingcar: 5,
  village: 2.5,
  monitor: 0.6,
  dit: 1.5,
  boom: 0.6,
  soundcart: 1,
  plantmic: 0.2,
  speaker: 0.5,
  prompter: 0.6,
  crew: 0.5,
  dirchair: 0.6,
  hmu: 1.5,
  rack: 1.5,
  crafty: 2,
  tent: [3, 3],
  actor: 0.5,
  support: 0.5,
  extra: 0.5,
  group: 1.5,
  seated: 0.6,
  lying: 1.8,
  child: 0.35,
  stunt: 0.5,
  mark: 0.3,
  animal: 0.8,
  wall: [3, 0.15],
  door: [1, 0.6],
  doubledoor: [1.6, 0.6],
  sliding: [1.6, 0.4],
  window: [1.2, 0.2],
  arch: [1, 0.2],
  column: [0.4, 0.4],
  stairs: [3, 1],
  platform: [2.4, 1.2],
  backdrop: [4, 0.3],
  curtain: [3, 0.3],
  flat: [2.4, 0.3],
  table: [1.6, 0.9],
  roundtable: [1.2, 1.2],
  desk: [1.4, 0.7],
  chair: [0.5, 0.5],
  armchair: [0.9, 0.8],
  sofa: [2, 0.9],
  stool: [0.4, 0.4],
  bench: [1.5, 0.4],
  bed: [2, 1.6],
  wardrobe: [1.8, 0.6],
  shelf: [1, 0.35],
  counter: [2.4, 0.6],
  kitchen: [0.6, 0.6],
  fridge: [0.7, 0.7],
  sink: [0.6, 0.5],
  bathtub: [1.7, 0.75],
  toilet: [0.7, 0.4],
  tv: [1.2, 0.3],
  piano: [1.5, 1.4],
  rug: [2.4, 1.7],
  plant: [0.5, 0.5],
  car: [4.5, 1.8],
  truck: [7, 2.5],
  moto: [2.1, 0.8],
  bike: [1.8, 0.6],
  road: [10, 6],
  tree: [4, 4],
  bush: [1.5, 1.5],
  fence: [3, 0.2],
  water: [4, 3],
  cone: [0.4, 0.4],
  barrier: [2, 0.6],
  light: 0.5,
  recorder: 0.4,
};

// Attachments ----------------------------------------------------------------------

/** How an icon attaches to its base: what it may sit on and where (decision 0104). */
export type AttachRole = 'modifier' | 'seated' | 'mounted' | 'dolly' | 'rigged';

const PEOPLE: readonly PlanIconKind[] = [
  'actor',
  'support',
  'extra',
  'group',
  'seated',
  'lying',
  'child',
  'stunt',
  'animal',
];
/** Seats and how many they take: people sit on them, facing their front. */
export const SEATS: Readonly<Partial<Record<PlanIconKind, number>>> = {
  chair: 1,
  armchair: 1,
  stool: 1,
  dirchair: 1,
  sofa: 3,
  bench: 3,
  bed: 2,
  car: 4,
  truck: 2,
  moto: 2,
  bike: 1,
};
const LIGHT_STANDS: readonly PlanIconKind[] = [
  'cstand',
  'combo',
  'lightstand',
  'roller',
  'boomarm',
  'rig',
  'polecat',
  'goalpost',
];
const CAMERA_SUPPORTS: readonly PlanIconKind[] = [
  'tripod',
  'hihat',
  'dolly',
  'slider',
  'jib',
  'techno',
  'carrig',
];
const FLAGS: readonly PlanIconKind[] = ['flag', 'floppy', 'cutter', 'net', 'dot', 'cuco', 'frame'];

/** The role an icon of this kind attaches with, or null when it never attaches. */
export function attachRole(kind: PlanIconKind): AttachRole | null {
  const k = catalogueKind(kind);
  if (groupOf(k).id === 'modifiers') return 'modifier';
  if (PEOPLE.includes(k)) return 'seated';
  if (isLight(k) || k === 'camera') return 'mounted';
  if (k === 'dolly') return 'dolly';
  if (FLAGS.includes(k)) return 'rigged';
  return null;
}

/**
 * Whether an icon of kind `item` may attach to one of kind `base` (the table of decision 0104):
 * modifiers on the front of any light; people on seats and vehicles; lights on stands, boom arm,
 * truss, pole cat and goal post; a camera on a tripod, hi-hat, dolly, slider, jib, crane or car
 * mount; a dolly on a track; flags, nets and frames on a C-stand. Doors and windows go in walls
 * as openings, not as icons.
 */
export function canAttach(item: PlanIconKind, base: PlanIconKind): boolean {
  const k = catalogueKind(item);
  const b = catalogueKind(base);
  switch (attachRole(k)) {
    case 'modifier':
      return isLight(b);
    case 'seated':
      return b in SEATS;
    case 'mounted':
      return k === 'camera' ? CAMERA_SUPPORTS.includes(b) : LIGHT_STANDS.includes(b);
    case 'dolly':
      return b === 'track' || b === 'curve';
    case 'rigged':
      return b === 'cstand';
    default:
      return false;
  }
}

/**
 * Order of modifiers stacked on one light, from the light outwards: the soft box first, then
 * doors and snoots, the grid, the scrim and gobo, the gel last. Equal ranks keep their order in
 * the plan.
 */
export const MODIFIER_RANK: Readonly<Partial<Record<PlanIconKind, number>>> = {
  softbox: 0,
  octa: 0,
  para: 0,
  barn: 1,
  snoot: 1,
  grid: 2,
  scrim: 3,
  gobo: 3,
  gel: 4,
};

/** Seats whose front is not the glyph's facing: a bed's people lie with their head on the pillows. */
export const SEAT_FACING: Readonly<Partial<Record<PlanIconKind, number>>> = { bed: 180 };

// Flattening ---------------------------------------------------------------------

/** A glyph part as a polyline in glyph units, for exports, hit tests and boxes. */
export interface FlatPart {
  points: number[];
  closed: boolean;
  width: number;
  dash?: number[];
  opacity?: number;
  butt?: boolean;
  /** How the part is filled, as in GlyphPart; omitted = not filled. */
  fill?: { mix?: number; alpha?: number; hole?: boolean };
  color?: string;
}

function arcPoints(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  large: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): number[] {
  // Endpoint to centre parameterisation (SVG 1.1, F.6.5), without x-axis rotation.
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx = (k * rx * dy) / ry + (x0 + x1) / 2;
  const cy = (-k * ry * dx) / rx + (y0 + y1) / 2;
  const a0 = Math.atan2((y0 - cy) / ry, (x0 - cx) / rx);
  let a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  if (sweep && a1 < a0) a1 += Math.PI * 2;
  if (!sweep && a1 > a0) a1 -= Math.PI * 2;
  const out: number[] = [];
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

/**
 * The subpaths of an SVG path of M, L, H, V, C, S, Q, T, A and Z commands, absolute or relative.
 */
export function flattenPath(d: string): Array<{ points: number[]; closed: boolean }> {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const out: Array<{ points: number[]; closed: boolean }> = [];
  let current: { points: number[]; closed: boolean } | null = null;
  let x = 0;
  let y = 0;
  // The control point of the last curve, reflected by S and T.
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
    for (let t = 1; t <= 10; t++) {
      const s = t / 10;
      const u = 1 - s;
      current?.points.push(
        u * u * u * x + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s * s * s * ex,
        u * u * u * y + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * ey,
      );
    }
    lastCubic = [c2x, c2y];
    x = ex;
    y = ey;
  };
  const quad = (cx: number, cy: number, ex: number, ey: number) => {
    for (let t = 1; t <= 8; t++) {
      const s = t / 8;
      const u = 1 - s;
      current?.points.push(
        u * u * x + 2 * u * s * cx + s * s * ex,
        u * u * y + 2 * u * s * cy + s * s * ey,
      );
    }
    lastQuad = [cx, cy];
    x = ex;
    y = ey;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] as string)) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const op = cmd.toLowerCase();
    const prevCubic: [number, number] | null = lastCubic;
    const prevQuad: [number, number] | null = lastQuad;
    lastCubic = null;
    lastQuad = null;
    switch (op) {
      case 'm':
        x = ox + num();
        y = oy + num();
        current = { points: [x, y], closed: false };
        out.push(current);
        // Pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      case 'l':
        x = ox + num();
        y = oy + num();
        current?.points.push(x, y);
        break;
      case 'h':
        x = ox + num();
        current?.points.push(x, y);
        break;
      case 'v':
        y = oy + num();
        current?.points.push(x, y);
        break;
      case 'c': {
        const [c1x, c1y, c2x, c2y, ex, ey] = [num(), num(), num(), num(), num(), num()].map(
          (v, n) => v + (n % 2 === 0 ? ox : oy),
        ) as [number, number, number, number, number, number];
        cubic(c1x, c1y, c2x, c2y, ex, ey);
        break;
      }
      case 's': {
        const [c2x, c2y, ex, ey] = [num(), num(), num(), num()].map(
          (v, n) => v + (n % 2 === 0 ? ox : oy),
        ) as [number, number, number, number];
        const c1: [number, number] = prevCubic
          ? [2 * x - prevCubic[0], 2 * y - prevCubic[1]]
          : [x, y];
        cubic(c1[0], c1[1], c2x, c2y, ex, ey);
        break;
      }
      case 'q': {
        const [cx, cy, ex, ey] = [num(), num(), num(), num()].map(
          (v, n) => v + (n % 2 === 0 ? ox : oy),
        ) as [number, number, number, number];
        quad(cx, cy, ex, ey);
        break;
      }
      case 't': {
        const ex = ox + num();
        const ey = oy + num();
        const c: [number, number] = prevQuad ? [2 * x - prevQuad[0], 2 * y - prevQuad[1]] : [x, y];
        quad(c[0], c[1], ex, ey);
        break;
      }
      case 'a': {
        const rx = num();
        const ry = num();
        num();
        const large = num() === 1;
        const sweep = num() === 1;
        const ex = ox + num();
        const ey = oy + num();
        current?.points.push(...arcPoints(x, y, rx, ry, large, sweep, ex, ey));
        x = ex;
        y = ey;
        break;
      }
      case 'z':
        if (current) {
          current.closed = true;
          x = current.points[0] as number;
          y = current.points[1] as number;
        }
        break;
      default:
        i++;
    }
  }
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

function rectPoints(r: number[]): number[] {
  const [x, y, w, h, rx = 0] = r as [number, number, number, number, number?];
  const c = Math.min(rx, w / 2, h / 2);
  const pts: number[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    if (c === 0) pts.push(cx, cy);
    else
      for (let i = 0; i <= 3; i++) {
        const a = from + (i / 3) * (Math.PI / 2);
        pts.push(cx + c * Math.cos(a), cy + c * Math.sin(a));
      }
  };
  corner(x + w - c, y + c, -Math.PI / 2);
  corner(x + w - c, y + h - c, 0);
  corner(x + c, y + h - c, Math.PI / 2);
  corner(x + c, y + c, Math.PI);
  return pts;
}

const flatCache = new Map<GlyphPart[], FlatPart[]>();

/** A glyph as polylines in its own units. */
export function flattenGlyph(glyph: GlyphPart[]): FlatPart[] {
  const hit = flatCache.get(glyph);
  if (hit) return hit;
  const out: FlatPart[] = [];
  for (const part of glyph) {
    const filled = part.mix !== undefined || part.alpha !== undefined || part.hole;
    const style: Omit<FlatPart, 'points' | 'closed'> = {
      width: part.w ?? DEFAULT_GLYPH_STROKE,
      ...(part.dash ? { dash: part.dash } : {}),
      ...(part.o !== undefined ? { opacity: part.o } : {}),
      ...(part.butt ? { butt: true } : {}),
      ...(part.color ? { color: part.color } : {}),
      ...(filled
        ? {
            fill: {
              ...(part.mix !== undefined ? { mix: part.mix } : {}),
              ...(part.alpha !== undefined ? { alpha: part.alpha } : {}),
              ...(part.hole ? { hole: true } : {}),
            },
          }
        : {}),
    };
    if (part.c) {
      const [cx, cy, r] = part.c as [number, number, number];
      out.push({ points: ellipsePoints(cx, cy, r, r), closed: true, ...style });
    } else if (part.e) {
      const [cx, cy, rx, ry] = part.e as [number, number, number, number];
      out.push({ points: ellipsePoints(cx, cy, rx, ry), closed: true, ...style });
    } else if (part.r) out.push({ points: rectPoints(part.r), closed: true, ...style });
    else if (part.d) for (const sub of flattenPath(part.d)) out.push({ ...sub, ...style });
  }
  flatCache.set(glyph, out);
  return out;
}

/** The drawn box of a glyph, in its units. */
export function glyphBox(glyph: GlyphPart[]): { x: number; y: number; w: number; h: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const part of flattenGlyph(glyph))
    for (let i = 0; i + 1 < part.points.length; i += 2) {
      x0 = Math.min(x0, part.points[i] as number);
      x1 = Math.max(x1, part.points[i] as number);
      y0 = Math.min(y0, part.points[i + 1] as number);
      y1 = Math.max(y1, part.points[i + 1] as number);
    }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
