// SPDX-License-Identifier: AGPL-3.0-only
import {
  blockingCurve,
  blockingPositions,
  categoryOf,
  type GlyphPart,
  glyphOf,
  iconCone,
  iconTransform,
  labelAnchor,
  layerOf,
  measureEnds,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanFamily,
  type PlanItem,
  type PlanNoteTool,
} from '@inkadra/canvas-core';
import {
  PLAN_ASPECT,
  type PlanIcon,
  type PlanIconKind,
  type PlanShape,
  type PlanStroke as PlanStrokeItem,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { type CSSProperties, memo, type ReactNode, useId } from 'react';
import { StrokePath } from '../film/FramePicture.tsx';
import { ShapeView } from '../film/shapes.tsx';

/**
 * The colours of a plan (decision 0062). Each is stored as a hex code, like a frame drawing's,
 * and drawn with the theme's token, so a wall in ink stays readable on a dark card and the
 * pastel accents of the dark theme turn darker on paper.
 */
export const PLAN_COLORS = [
  { hex: '#1C1C1E', token: 'text-secondary', name: 'ink' },
  { hex: '#9DB8F2', token: 'tag-blue', name: 'blue' },
  { hex: '#EDD963', token: 'tag-yellow', name: 'yellow' },
  { hex: '#B897F0', token: 'tag-purple', name: 'purple' },
  { hex: '#7AD689', token: 'tag-green', name: 'green' },
] as const;
export type PlanColor = (typeof PLAN_COLORS)[number];
export const PLAN_INK = PLAN_COLORS[0].hex;

/** The colour a family starts in: lights yellow, cameras blue, people purple, the rest ink. */
const FAMILY_COLORS: Record<PlanFamily, string> = {
  light: PLAN_COLORS[2].hex,
  camera: PLAN_COLORS[1].hex,
  person: PLAN_COLORS[3].hex,
  ink: PLAN_INK,
};
/** Annotations (arrows, texts, measures, zones) start green, as in the library. */
export const NOTE_COLOR = PLAN_COLORS[4].hex;

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
export const LABEL_SIZE = 16;
export const PLAN_TEXT = TEXT_SIZES.M;

/** Fill of the closed parts of an icon: a veil of its colour, what lies under it still shows. */
const WASH = 'color-mix(in srgb, currentColor 12%, transparent)';

/** The parts of a glyph as SVG, in its 32 grid. `fill` paints closed parts. */
export function GlyphParts({ glyph, fill }: { glyph: GlyphPart[]; fill?: string }) {
  return glyph.map((part, i) => {
    const style: CSSProperties = {
      strokeWidth: part.w,
      strokeDasharray: part.dash?.join(' '),
      opacity: part.o,
    };
    const key = i;
    if (part.c) {
      const [cx, cy, r] = part.c;
      return <circle key={key} cx={cx} cy={cy} r={r} style={{ ...style, fill }} />;
    }
    if (part.r) {
      const [x, y, w, h, rx] = part.r;
      return (
        <rect
          key={key}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx || undefined}
          transform={part.rot ? `rotate(${part.rot.join(' ')})` : undefined}
          style={{ ...style, fill }}
        />
      );
    }
    return (
      <path
        key={key}
        d={part.d}
        style={{ ...style, fill: /z$/i.test(part.d ?? '') ? fill : undefined }}
      />
    );
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
    <svg className="plan-glyph" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <GlyphParts glyph={glyphOf(kind)} />
    </svg>
  );
}

/** "A cam · 35 mm": the label of an icon on the plan. */
export function iconLabel(icon: PlanIcon): string {
  const mm = icon.lens ?? 35;
  // "A cam 35mm" already says it: no "· 35 mm" again.
  const said = new RegExp(`\\b${mm}\\s?mm\\b`, 'i').test(icon.label ?? '');
  const lens = icon.kind === 'camera' && icon.showLens && !said ? `${mm} mm` : '';
  const power = icon.power && !icon.label?.includes(icon.power) ? icon.power : '';
  return [icon.label, lens, power].filter(Boolean).join(' · ');
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
  return (
    <text
      className="plan__label"
      x={at.x}
      y={at.y + (lifted ? 20 : 0)}
      textAnchor="middle"
      fontSize={LABEL_SIZE}
      fontWeight={500}
      fontFamily="inherit"
      style={{ color: planCss(icon.color) }}
    >
      {label}
    </text>
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
  const cone = noCone ? null : iconCone(icon, sensor);
  const scale = Math.sqrt(t.sx * t.sy);
  return (
    <g
      style={{ color: planCss(icon.color), opacity: faded ? 0.4 : undefined }}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={icon.id}
    >
      {cone && (
        <polygon
          points={cone.points.map((p) => `${p.x},${p.y}`).join(' ')}
          style={{
            fill: 'currentColor',
            fillOpacity: cone.beam ? 0.06 + 0.16 * (icon.intensity ?? 0.8) : 0.14,
            stroke: 'currentColor',
            strokeOpacity: 0.5,
            strokeWidth: 1.5,
          }}
        />
      )}
      <g
        transform={`translate(${t.centre.x} ${t.centre.y}) rotate(${t.angle}) scale(${t.sx} ${t.sy}) translate(${-t.origin.x} ${-t.origin.y})`}
        style={{
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5 * Math.min(1.6, 1.7 / scale),
        }}
      >
        <GlyphParts glyph={glyphOf(icon.kind)} fill={WASH} />
      </g>
    </g>
  );
});

/** Radius of the number of a blocking position, in view units. */
const STEP_DOT = 11;

/**
 * The blocking of an icon (round 6, d): its earlier positions as veiled copies, the moves
 * between them as arrows (dashed for the camera, say), each position numbered. `ghosts` false
 * leaves the veiled copies out.
 */
export const BlockingView = memo(function BlockingView({
  icon,
  ghosts = true,
}: {
  icon: PlanIcon;
  ghosts?: boolean;
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
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: moves are the gaps between steps.
            key={i}
            d={`M${a.x} ${a.y}Q${control.x} ${control.y} ${end.x} ${end.y}M${wing(-1)}L${end.x} ${end.y}L${wing(1)}`}
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
      {at.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the number is the place in the order.
        <g key={i} className="plan__step" transform={`translate(${p.x - 24} ${p.y - 24})`}>
          <circle r={STEP_DOT} style={{ fill: 'currentColor' }} />
          <text textAnchor="middle" y={4.5} fontSize={13} fontWeight={700}>
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
});

/** Length of a measure in metres, "2,70 m", or null on a plan without a scale. */
export function measureText(shape: PlanShape, scale: number | undefined, locale?: string): string {
  if (!scale) return '';
  const dx = ((shape.x1 - shape.x0) / STROKE_GRID) * PLAN_VIEW_W;
  const dy = ((shape.y1 - shape.y0) / STROKE_GRID) * PLAN_VIEW_H;
  const m = Math.hypot(dx, dy) / scale;
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
>;

const visible = <T extends PlanItem>(items: readonly T[] | undefined, hidden?: readonly string[]) =>
  (items ?? []).filter((item) => !hidden?.includes(layerOf(item)));

/**
 * A plan's drawing: strokes, then shapes and texts, then set icons, as vectors in the plan's
 * aspect ratio, its hidden layers left out. `grid` shows the dots while editing (every `step`
 * view units); `children` draws on top (the live line, the selection). Memoized: it redraws
 * only when the plan changes.
 */
export const PlanDrawing = memo(function PlanDrawing({
  plan,
  grid,
  hidden,
  ghosts = true,
  moves = true,
  lifted,
  children,
}: {
  plan: PlanLike;
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
  return (
    <svg
      className="plan__svg"
      viewBox={`0 0 ${PLAN_VIEW_W} ${PLAN_VIEW_H}`}
      style={{ aspectRatio: String(PLAN_ASPECT) }}
      aria-hidden="true"
    >
      {grid && <GridDots step={grid} />}
      {visible(plan.strokes, off).map((s) => (
        <PlanStroke key={s.id} stroke={s} />
      ))}
      {visible(plan.shapes, off).map((s) => (
        <PlanShapeView key={s.id} shape={measureEnds(s, plan.icons)} scale={plan.scale} />
      ))}
      {moves &&
        visible(plan.icons, off).map((icon) => (
          <BlockingView key={`b${icon.id}`} icon={icon} ghosts={ghosts} />
        ))}
      {visible(plan.icons, off).map((icon) => (
        <PlanIconView key={icon.id} icon={icon} sensor={plan.sensor} />
      ))}
      {visible(plan.icons, off).map((icon) => (
        <PlanLabel key={`l${icon.id}`} icon={icon} lifted={lifted?.has(icon.id)} />
      ))}
      {children}
    </svg>
  );
});
