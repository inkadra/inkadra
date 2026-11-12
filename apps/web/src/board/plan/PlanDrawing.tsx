// SPDX-License-Identifier: AGPL-3.0-only
import {
  beamWarmth,
  blockingCurve,
  blockingPositions,
  type CardsById,
  categoryOf,
  DEFAULT_GLYPH_STROKE,
  type GlyphPart,
  glyphOf,
  iconCone,
  iconGlow,
  iconGlyph,
  iconLabel,
  iconSubLabel,
  iconTransform,
  PLAN_LABEL_SIZE,
  PLAN_SUB_LABEL_SIZE,
  labelAnchor,
  linkedPlan,
  measureEnds,
  openingLines,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanFamily,
  type PlanNoteTool,
  type PlanStackEntry,
  pieceOutline,
  planFrame,
  planStack,
  shownOpenings,
  wallPieces,
  wallPoints,
} from '@inkadra/canvas-core';
import {
  PLAN_ASPECT,
  type PlanIcon,
  type PlanIconKind,
  type PlanShape,
  type PlanStroke as PlanStrokeItem,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import {
  type CSSProperties,
  createContext,
  memo,
  type ReactNode,
  useContext,
  useId,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { BoardContext } from '../context.ts';
import { StrokePath } from '../film/FramePicture.tsx';
import { ShapeView } from '../film/shapes.tsx';
import { PlanBackgroundView } from './PlanBackground.tsx';

/**
 * The colours of a plan (decision 0062). Each is stored as a hex code, like a frame drawing's,
 * and drawn with the theme's token, so a wall in ink stays readable on a dark card and the
 * pastel accents of the dark theme turn darker on paper.
 */
export const PLAN_COLORS = [
  { hex: '#1C1C1E', token: 'text-secondary', name: 'ink' },
  { hex: '#9DB8F2', token: 'tag-blue', name: 'blue' },
  { hex: '#60D8EB', token: 'tag-teal', name: 'teal' },
  { hex: '#7AD689', token: 'tag-green', name: 'green' },
  { hex: '#EDD963', token: 'tag-yellow', name: 'yellow' },
  { hex: '#F79B54', token: 'tag-orange', name: 'orange' },
  { hex: '#F68186', token: 'tag-red', name: 'red' },
  { hex: '#FF91CC', token: 'tag-pink', name: 'pink' },
  { hex: '#B897F0', token: 'tag-purple', name: 'purple' },
] as const;
export type PlanColor = (typeof PLAN_COLORS)[number];
export const PLAN_INK = PLAN_COLORS[0].hex;
/** The colours a linked actor takes from its character, one per character (decision 0104). */
export const CHARACTER_COLOURS: readonly string[] = PLAN_COLORS.slice(1).map((c) => c.hex);

/**
 * The cards a plan's links resolve against wherever it is drawn (decision 0104): the board's,
 * as this person sees them (a guest's are already cut to what a guest may see). Without it a
 * plan draws the text its icons hold.
 */
export const PlanCardsContext = createContext<CardsById | null>(null);

const noStore = () => () => {};

/**
 * A plan with its links resolved against the cards of the context, else of the board it is
 * drawn on, for drawing and lists.
 */
export function useLinkedPlan<P extends Pick<PlanElement, 'icons'>>(plan: P): P {
  const given = useContext(PlanCardsContext);
  const board = useContext(BoardContext)?.store;
  const onBoard = useSyncExternalStore(board?.subscribe ?? noStore, () =>
    board ? board.getSnapshot().byId : null,
  );
  const cards = given ?? onBoard;
  return useMemo(
    () => (cards ? linkedPlan(plan, cards, { palette: CHARACTER_COLOURS }) : plan),
    [plan, cards],
  );
}

/**
 * The colour a family starts in: lights yellow, cameras blue, video and sound teal, people
 * purple, the rest ink.
 */
const FAMILY_COLORS: Record<PlanFamily, string> = {
  light: '#EDD963',
  camera: '#9DB8F2',
  video: '#60D8EB',
  person: '#B897F0',
  ink: PLAN_INK,
};
/** Annotations (arrows, texts, measures, zones) start green, as in the library. */
export const NOTE_COLOR = '#7AD689';

export function iconColor(kind: PlanIconKind): string {
  return FAMILY_COLORS[categoryOf(kind).family];
}

/** Token of a stored colour, or null for a colour outside the palette (drawn as it is). */
export function planToken(hex: string): string | null {
  return PLAN_COLORS.find((c) => c.hex === hex)?.token ?? null;
}

/** CSS colour of a stored colour on the board. */
export function planCss(hex: string): string {
  const token = planToken(hex);
  return token ? `var(--ink-${token})` : hex;
}

/** Line width of the pen and of shapes, in thousandths of the width. */
export const PLAN_PEN = 4;
/** Font sizes of texts, S, M and L, in thousandths of the width. */
export const TEXT_SIZES = { S: 14, M: 18, L: 26 } as const;
/** Font size of icon labels, in thousandths of the width. */
/** Sizes of an icon's label and of a light's second line (canvas-core, decision 0118). */
export const LABEL_SIZE = PLAN_LABEL_SIZE;
export const SUB_LABEL_SIZE = PLAN_SUB_LABEL_SIZE;
// The words of the plan live in canvas-core (decision 0116); the web's callers import them here.
export { iconLabel, iconSubLabel };
export const PLAN_TEXT = TEXT_SIZES.M;

/** The paper of a plan: what opaque fills mix into and holes show (decision 0104). */
const PAPER = 'var(--plan-paper, var(--ink-surface-1))';

/**
 * The fill of a glyph part (decision 0104): opaque parts mix the icon's colour into the paper, so
 * what lies under them is hidden; see-through parts (an overhead frame, a tent) veil it.
 */
function partFill(part: GlyphPart): CSSProperties {
  const color = part.color ? planCss(part.color) : 'currentColor';
  if (part.hole) return { fill: PAPER };
  if (part.mix !== undefined)
    return { fill: `color-mix(in srgb, ${color} ${Math.round(part.mix * 100)}%, ${PAPER})` };
  if (part.alpha !== undefined) return { fill: color, fillOpacity: part.alpha };
  return {};
}

/** The parts of a glyph as SVG, in its units (a 40 box centred on 0,0). */
export function GlyphParts({ glyph }: { glyph: GlyphPart[] }) {
  return glyph.map((part, i) => {
    const style: CSSProperties = {
      strokeWidth: part.w,
      strokeDasharray: part.dash?.join(' '),
      strokeOpacity: part.o,
      strokeLinecap: part.butt ? 'butt' : undefined,
      stroke: part.color ? planCss(part.color) : undefined,
      ...partFill(part),
    };
    const key = i;
    if (part.c) {
      const [cx, cy, r] = part.c;
      return <circle key={key} cx={cx} cy={cy} r={r} style={style} />;
    }
    if (part.e) {
      const [cx, cy, rx, ry] = part.e;
      return <ellipse key={key} cx={cx} cy={cy} rx={rx} ry={ry} style={style} />;
    }
    if (part.r) {
      const [x, y, w, h, rx] = part.r;
      return <rect key={key} x={x} y={y} width={w} height={h} rx={rx || undefined} style={style} />;
    }
    return <path key={key} d={part.d} style={style} />;
  });
}

/** A library glyph at icon size, in the UI (the icon tiles of the library). */
export function PlanGlyph({
  kind,
  size = 28,
}: {
  kind: PlanIconKind | PlanNoteTool;
  size?: number;
}) {
  return (
    <svg
      className="plan-glyph"
      viewBox="-20 -20 40 40"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <GlyphParts glyph={glyphOf(kind)} />
    </svg>
  );
}




/**
 * The label of an icon, over everything else of the plan, with a halo of the card's colour so
 * it reads over walls and beams; `lifted` moves it past the handles of a selected icon.
 */
export const PlanLabel = memo(function PlanLabel({
  icon,
  lifted,
}: {
  icon: PlanIcon;
  lifted?: boolean | undefined;
}) {
  const label = iconLabel(icon);
  if (!label) return null;
  const at = labelAnchor(icon);
  const sub = iconSubLabel(icon);
  const y = at.y + (lifted ? 20 : 0);
  return (
    <>
      <text
        className="plan__label"
        x={at.x}
        y={y}
        textAnchor="middle"
        fontSize={LABEL_SIZE}
        fontWeight={500}
        fontFamily="inherit"
        style={{ color: planCss(icon.color) }}
      >
        {label}
      </text>
      {sub && (
        <text
          className="plan__label plan__label--dim"
          x={at.x}
          y={y + LABEL_SIZE + 2}
          textAnchor="middle"
          fontSize={SUB_LABEL_SIZE}
          fontFamily="inherit"
        >
          {sub}
        </text>
      )}
    </>
  );
});

/** A set icon in view units: its cone or beam and its glyph (its label is drawn last). */
export const PlanIconView = memo(function PlanIconView({
  icon,
  sensor,
  faded,
  noCone,
}: {
  icon: PlanIcon;
  sensor?: PlanElement['sensor'];
  /** An earlier position in blocking: a veiled copy. */
  faded?: boolean;
  noCone?: boolean;
}) {
  const t = iconTransform(icon);
  const scale = Math.sqrt(t.sx * t.sy);
  return (
    <g
      style={{ color: planCss(icon.color), opacity: faded ? 0.4 : undefined }}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={icon.id}
    >
      {!noCone && <PlanBeamView icon={icon} sensor={sensor} />}
      <g
        transform={`translate(${t.centre.x} ${t.centre.y}) rotate(${t.angle}) scale(${t.sx} ${t.sy}) translate(${-t.origin.x} ${-t.origin.y})`}
        style={{
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: DEFAULT_GLYPH_STROKE * Math.min(1.6, 1.7 / scale),
        }}
      >
        <GlyphParts glyph={iconGlyph(icon)} />
      </g>
    </g>
  );
});

/**
 * The colour of a light's beam: tinted from the palette's orange (warm) to its blue (cool) by its
 * colour temperature, or its own colour without one (decision 0104).
 */
export function beamCss(icon: PlanIcon): string {
  const warmth = beamWarmth(icon.kind === 'camera' ? undefined : icon.kelvin);
  if (warmth === null) return planCss(icon.color);
  return `color-mix(in srgb, var(--ink-tag-orange) ${Math.round(warmth * 100)}%, var(--ink-tag-blue))`;
}

/** A camera's view cone, a light's beam or the glow of a light that shines all round. */
export const PlanBeamView = memo(function PlanBeamView({
  icon,
  sensor,
}: {
  icon: PlanIcon;
  sensor?: PlanElement['sensor'];
}) {
  const id = `plan-beam-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const cone = iconCone(icon, sensor);
  const glow = cone ? null : iconGlow(icon);
  if (!cone && !glow) return null;
  const color = beamCss(icon);
  const strength = 0.06 + 0.16 * (icon.intensity ?? 0.8);
  if (glow)
    return (
      <g style={{ color }}>
        <defs>
          <radialGradient id={id}>
            <stop offset="0" stopColor="currentColor" stopOpacity={strength * 2} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={glow.centre.x} cy={glow.centre.y} r={glow.radius} fill={`url(#${id})`} />
      </g>
    );
  const [from] = cone?.points ?? [];
  return (
    <g style={{ color: cone?.beam ? color : planCss(icon.color) }}>
      {cone?.beam && from && (
        <defs>
          <radialGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            cx={from.x}
            cy={from.y}
            r={cone.reach}
          >
            <stop offset="0" stopColor="currentColor" stopOpacity={strength * 2} />
            <stop offset="1" stopColor="currentColor" stopOpacity={strength / 3} />
          </radialGradient>
        </defs>
      )}
      <polygon
        points={cone?.points.map((p) => `${p.x},${p.y}`).join(' ')}
        style={{
          fill: cone?.beam ? `url(#${id})` : 'currentColor',
          fillOpacity: cone?.beam ? undefined : 0.14,
          stroke: 'currentColor',
          strokeOpacity: cone?.beam ? 0.35 : 0.5,
          strokeWidth: 1.5,
        }}
      />
    </g>
  );
});

/** Width of the lines of doors and windows, in view units. */
const OPENING_LINE = 1.6;

/**
 * The walls of a plan with their openings (decision 0104): each piece between the gaps filled in
 * the ink of walls, then the doors, windows and openings drawn in their gaps.
 */
export const PlanWallsView = memo(function PlanWallsView({
  plan,
}: {
  plan: Pick<PlanElement, 'walls' | 'openings'>;
}) {
  const walls = plan.walls ?? [];
  if (walls.length === 0) return null;
  const openings = shownOpenings(plan);
  const byId = new Map(walls.map((w) => [w.id, w]));
  return (
    <g className="plan__walls" style={{ color: planCss(PLAN_INK) }}>
      {/* A closed room's floor, tinted under everything (audit L1). */}
      {walls
        .filter((w) => w.closed)
        .map((wall) => (
          <polygon
            key={`f${wall.id}`}
            className="plan__floor"
            points={wallPoints(wall)
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
          />
        ))}
      {walls.flatMap((wall) =>
        wallPieces(wall, openings).map((piece, i) => (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: a piece is its place between gaps.
            key={`${wall.id}-${i}`}
            points={pieceOutline(piece, wall.thickness)
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
            style={{ fill: 'currentColor' }}
          />
        )),
      )}
      {openings.map((o) => {
        const wall = byId.get(o.wall);
        if (!wall) return null;
        return (
          <g key={o.id} data-opening={o.id}>
            {openingLines(wall, o).map((line, i) => (
              <polyline
                // biome-ignore lint/suspicious/noArrayIndexKey: lines of one opening, in order.
                key={i}
                points={line.points.map((p) => `${p.x},${p.y}`).join(' ')}
                style={{
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: line.leaf ? OPENING_LINE * 1.8 : OPENING_LINE,
                  strokeDasharray: line.dashed ? '4 4' : undefined,
                  strokeLinecap: 'butt',
                }}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
});

/** Radius of the number of a blocking position, in view units. */
const STEP_DOT = 11;
/** Where the editor draws a position's number: under it and to the left, clear of its label. */
const STEP_BELOW = 20;
const STEP_BESIDE = 26;

/**
 * The blocking of an icon (round 6, d): its earlier positions as veiled copies, the moves
 * between them as arrows (dashed for the camera, say), each position numbered. `ghosts` false
 * leaves the veiled copies out. `route` is how the editor draws it: a plain line through numbered
 * points, the icon itself being the last position.
 */
export const BlockingView = memo(function BlockingView({
  icon,
  ghosts = true,
  route = false,
}: {
  icon: PlanIcon;
  ghosts?: boolean;
  route?: boolean;
}) {
  const steps = icon.steps ?? [];
  if (steps.length === 0) return null;
  const at = blockingPositions(icon);
  const dash = icon.dashed ? '10 8' : undefined;
  return (
    <g style={{ color: planCss(icon.color) }} data-blocking={icon.id}>
      {at.slice(1).map((b, i) => {
        const a = at[i] as { x: number; y: number };
        const { control } = blockingCurve(a, b, steps[i]?.bend);
        const angle = Math.atan2(b.y - control.y, b.x - control.x);
        // Stop short of the icon so the head shows.
        const back = 26;
        const end = { x: b.x - back * Math.cos(angle), y: b.y - back * Math.sin(angle) };
        const wing = (side: number) =>
          `${end.x - 14 * Math.cos(angle + side * 0.5)} ${end.y - 14 * Math.sin(angle + side * 0.5)}`;
        const way = route
          ? `M${a.x} ${a.y}Q${control.x} ${control.y} ${b.x} ${b.y}`
          : `M${a.x} ${a.y}Q${control.x} ${control.y} ${end.x} ${end.y}M${wing(-1)}L${end.x} ${end.y}L${wing(1)}`;
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: moves are the gaps between steps.
            key={i}
            d={way}
            style={{
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2.5,
              strokeDasharray: dash,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }}
          />
        );
      })}
      {ghosts &&
        steps.map((step, i) => (
          <PlanIconView
            // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the order.
            key={i}
            icon={{
              ...icon,
              x: step.x,
              y: step.y,
              ...(step.rotation ? { rotation: step.rotation } : { rotation: 0 }),
            }}
            faded
            noCone
          />
        ))}
    </g>
  );
});

/** The numbers of a blocking, drawn after the icons so that none hides under one. */
const BlockingNumbers = memo(function BlockingNumbers({
  icon,
  route,
}: {
  icon: PlanIcon;
  route: boolean;
}) {
  if (!icon.steps?.length) return null;
  const at = blockingPositions(icon);
  return (
    <g style={{ color: planCss(icon.color) }}>
      {at.map((p, i) => (
        <g
          // biome-ignore lint/suspicious/noArrayIndexKey: the number is the place in the order.
          key={i}
          className="plan__step"
          // In the editor each position, the last too, is numbered beside it (audit M5).
          transform={
            route
              ? `translate(${p.x - STEP_BESIDE} ${p.y + STEP_BELOW})`
              : `translate(${p.x - 24} ${p.y - 24})`
          }
        >
          <circle r={STEP_DOT} style={{ fill: 'currentColor' }} />
          <text textAnchor="middle" y={4.5} fontSize={13} fontWeight={600}>
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
});

/**
 * Length of a measure in metres, "2,70 m": what was written on it (in `text`, a plain number), or
 * else what the scale says; '' on a plan without a scale.
 */
export function measureText(shape: PlanShape, scale: number | undefined, locale?: string): string {
  const written = shape.text ? Number(shape.text) : 0;
  if (!(written > 0) && !scale) return '';
  const dx = ((shape.x1 - shape.x0) / STROKE_GRID) * PLAN_VIEW_W;
  const dy = ((shape.y1 - shape.y0) / STROKE_GRID) * PLAN_VIEW_H;
  const m = written > 0 ? written : Math.hypot(dx, dy) / (scale as number);
  return `${m.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/** A shape of a plan: a frame shape turned by its rotation, or a zone or a measure. */
export const PlanShapeView = memo(function PlanShapeView({
  shape,
  scale,
}: {
  shape: PlanShape;
  scale?: number | undefined;
}) {
  const x0 = (shape.x0 / STROKE_GRID) * PLAN_VIEW_W;
  const y0 = (shape.y0 / STROKE_GRID) * PLAN_VIEW_H;
  const x1 = (shape.x1 / STROKE_GRID) * PLAN_VIEW_W;
  const y1 = (shape.y1 / STROKE_GRID) * PLAN_VIEW_H;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const turn = shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined;
  let body: ReactNode;
  if (shape.kind === 'zone') {
    body = (
      <>
        <rect
          x={Math.min(x0, x1)}
          y={Math.min(y0, y1)}
          width={Math.abs(x1 - x0)}
          height={Math.abs(y1 - y0)}
          style={{
            fill: 'currentColor',
            fillOpacity: 0.1,
            stroke: 'currentColor',
            strokeWidth: shape.width,
            strokeDasharray: `${shape.width * 3} ${shape.width * 2.5}`,
          }}
        />
        {shape.text && (
          <text
            x={Math.min(x0, x1) + 10}
            y={Math.min(y0, y1) + PLAN_TEXT}
            fontSize={TEXT_SIZES.S}
            fill="currentColor"
            fontFamily="inherit"
          >
            {shape.text}
          </text>
        )}
      </>
    );
  } else if (shape.kind === 'measure') {
    const label = measureText(shape, scale);
    const a = Math.atan2(y1 - y0, x1 - x0);
    const tick = (x: number, y: number) =>
      `M${x - 9 * Math.sin(a)} ${y + 9 * Math.cos(a)}L${x + 9 * Math.sin(a)} ${y - 9 * Math.cos(a)}`;
    const w = label.length * 11 + 16;
    body = (
      <>
        <path
          d={`M${x0} ${y0}L${x1} ${y1}${tick(x0, y0)}${tick(x1, y1)}`}
          style={{
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeDasharray: shape.dashed ? '8 6' : undefined,
          }}
        />
        {label && (
          <g className="plan__chip">
            <rect x={cx - w / 2} y={cy - 15} width={w} height={30} rx={6} />
            <text x={cx} y={cy + 7} textAnchor="middle" fontSize={TEXT_SIZES.S} fontWeight={600}>
              {label}
            </text>
          </g>
        )}
      </>
    );
  } else {
    body = (
      <ShapeView shape={{ ...shape, kind: shape.kind }} height={PLAN_VIEW_H} color="currentColor" />
    );
  }
  return (
    <g style={{ color: planCss(shape.color) }} transform={turn}>
      {body}
    </g>
  );
});

const PlanStroke = memo(function PlanStroke({ stroke }: { stroke: PlanStrokeItem }) {
  return (
    <g style={{ color: planCss(stroke.color) }}>
      <StrokePath stroke={stroke} height={PLAN_VIEW_H} color="currentColor" />
    </g>
  );
});

/** The dots of the plan's own grid, one every `step` view units. */
function GridDots({ step }: { step: number }) {
  const id = `plan-grid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      <defs>
        <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
          <circle cx={step / 2} cy={step / 2} r={2.2} className="plan__dot" />
        </pattern>
      </defs>
      <rect
        x={-step / 2}
        y={-step / 2}
        width={PLAN_VIEW_W + step}
        height={PLAN_VIEW_H + step}
        fill={`url(#${id})`}
      />
    </>
  );
}

export type PlanLike = Pick<
  PlanElement,
  'strokes' | 'shapes' | 'icons' | 'hiddenLayers' | 'sensor' | 'scale'
> &
  Partial<Pick<PlanElement, 'walls' | 'openings' | 'background'>>;

/** An item of the plan's stack as SVG. */
function StackItem({ entry, plan }: { entry: PlanStackEntry; plan: PlanLike }) {
  const { ref, item } = entry;
  if (ref.kind === 'strokes') return <PlanStroke stroke={item as PlanStrokeItem} />;
  if (ref.kind === 'shapes')
    return <PlanShapeView shape={measureEnds(item as PlanShape, plan.icons)} scale={plan.scale} />;
  return <PlanIconView icon={item as PlanIcon} sensor={plan.sensor} noCone />;
}

/**
 * A plan's drawing, as vectors in the plan's aspect ratio, its hidden layers left out, in the
 * stacking order of decision 0104: walls, then the items of tiers 0 and 1 (the set, furniture),
 * the beams and cones, blocking moves, the items of tiers 2 to 5, blocking numbers, labels. `grid` shows the dots while editing (every `step`
 * view units); `children` draws on top (the live line, the selection). Memoized: it redraws
 * only when the plan changes.
 */
export const PlanDrawing = memo(function PlanDrawing(props: Parameters<typeof PlanDrawingView>[0]) {
  return <PlanDrawingView {...props} plan={useLinkedPlan(props.plan)} />;
});

const PlanDrawingView = memo(function PlanDrawingView({
  plan,
  grid,
  hidden,
  ghosts = true,
  route = false,
  moves = true,
  lifted,
  label,
  background = false,
  extent = false,
  children,
}: {
  plan: PlanLike;
  /**
   * Draws in the coordinates of the plan's 3:2 extent, what lies beyond it too, for a surface
   * that pans and zooms (the editor, the view). Otherwise the drawing frames what is on the plan
   * (planFrame, decision 0118): the card, the slides, the call sheet.
   */
  extent?: boolean;
  /**
   * The picture under the plan (decision 0110): drawn in the editor and on the board card, left
   * out of the slides and sheets, as of exports, unless they ask for it.
   */
  background?: boolean;
  /** Names the drawing for the editor, where it holds a control; elsewhere it stays hidden. */
  label?: string;
  /** Blocking as the editor draws it: a line through numbered points. */
  route?: boolean;
  /** Icons whose labels move past the selection handles. */
  lifted?: ReadonlySet<string> | undefined;
  /** Blocking moves and numbers; an export may leave them out. */
  moves?: boolean;
  /** Veiled copies of the earlier blocking positions; the arrows and numbers stay. */
  ghosts?: boolean;
  grid?: number | undefined;
  /** Layers this person hides while editing, on top of the plan's own. */
  hidden?: readonly string[] | undefined;
  children?: ReactNode;
}) {
  const off = [...(plan.hiddenLayers ?? []), ...(hidden ?? [])];
  const stack = planStack(plan, off);
  const icons = stack.filter((e) => e.ref.kind === 'icons').map((e) => e.item as PlanIcon);
  const frame = extent
    ? { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H }
    : planFrame(plan, background && !off.includes('set'));
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: named by aria-label in the editor, hidden elsewhere.
    <svg
      className="plan__svg"
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      style={{ aspectRatio: String(PLAN_ASPECT) }}
      {...(label ? { role: 'group', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {background && plan.background && !off.includes('set') && (
        <PlanBackgroundView background={plan.background} />
      )}
      {grid && <GridDots step={grid} />}
      {!off.includes('set') && <PlanWallsView plan={plan} />}
      {stack
        .filter((e) => e.tier < 2)
        .map((e) => (
          <StackItem key={e.item.id} entry={e} plan={plan} />
        ))}
      {icons.map((icon) => (
        <PlanBeamView key={`c${icon.id}`} icon={icon} sensor={plan.sensor} />
      ))}
      {moves &&
        icons.map((icon) => (
          <BlockingView key={`b${icon.id}`} icon={icon} ghosts={ghosts} route={route} />
        ))}
      {stack
        .filter((e) => e.tier >= 2)
        .map((e) => (
          <StackItem key={e.item.id} entry={e} plan={plan} />
        ))}
      {moves &&
        icons.map((icon) => <BlockingNumbers key={`n${icon.id}`} icon={icon} route={route} />)}
      {icons.map((icon) => (
        <PlanLabel key={`l${icon.id}`} icon={icon} lifted={lifted?.has(icon.id)} />
      ))}
      {children}
    </svg>
  );
});
