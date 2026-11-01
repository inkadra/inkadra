// SPDX-License-Identifier: AGPL-3.0-only
import {
  iconCentre,
  labelAnchor,
  PLAN_GRID,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanPaint,
  type PlanPart,
  planIconParts,
} from '@inkadra/canvas-core';
import { PLAN_ASPECT, type PlanIcon, type PlanIconKind } from '@inkadra/doc-schema';
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

/** The colour a new icon takes: cameras blue, lights yellow, actors purple, the set in ink. */
export const ICON_COLORS: Record<PlanIconKind, string> = {
  camera: PLAN_COLORS[1].hex,
  light: PLAN_COLORS[2].hex,
  actor: PLAN_COLORS[3].hex,
  door: PLAN_INK,
  window: PLAN_INK,
  table: PLAN_INK,
  track: PLAN_INK,
};

/** Token of a stored colour, or null for a colour outside the palette (drawn as it is). */
export function planToken(hex: string): string | null {
  return PLAN_COLORS.find((c) => c.hex === hex)?.token ?? null;
}

/** CSS colour of a stored colour on the board. */
export function planCss(hex: string): string {
  const token = planToken(hex);
  return token ? `var(--ink-${token})` : hex;
}

/** Line width of the pen and of shapes, and font size of texts, in thousandths of the width. */
export const PLAN_PEN = 4;
export const PLAN_TEXT = 24;

const PAINT: Record<PlanPaint, { color: string; opacity?: number }> = {
  ink: { color: 'currentColor' },
  soft: { color: 'currentColor', opacity: 0.25 },
  wash: { color: 'currentColor', opacity: 0.14 },
  faint: { color: 'currentColor', opacity: 0.5 },
  muted: { color: 'var(--ink-text-muted)' },
  surface: { color: 'var(--ink-surface-1)' },
  raised: { color: 'var(--ink-surface-2)' },
};

function partStyle(part: PlanPart): CSSProperties {
  const fill = part.fill ? PAINT[part.fill] : null;
  const stroke = part.stroke ? PAINT[part.stroke] : null;
  return {
    fill: fill?.color ?? 'none',
    fillOpacity: fill?.opacity,
    stroke: stroke?.color ?? 'none',
    strokeOpacity: stroke?.opacity,
    strokeWidth: part.width,
    strokeDasharray: part.dash ? `${part.width * 3} ${part.width * 3}` : undefined,
  };
}

function Part({ part }: { part: PlanPart }) {
  const style = partStyle(part);
  if (part.circle) return <circle {...part.circle} style={style} />;
  const pts = part.points ?? [];
  const pairs: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]},${pts[i + 1]}`);
  return part.closed ? (
    <polygon points={pairs.join(' ')} style={style} />
  ) : (
    <polyline points={pairs.join(' ')} style={style} />
  );
}

/** A set icon in view units, with its label under it. */
export function PlanIconView({ icon }: { icon: PlanIcon }) {
  const c = iconCentre(icon);
  const label = icon.label ? labelAnchor(icon) : null;
  return (
    <g style={{ color: planCss(icon.color) }} strokeLinecap="round" strokeLinejoin="round">
      <g transform={`translate(${c.x} ${c.y}) rotate(${icon.rotation ?? 0})`}>
        {planIconParts(icon.kind).map((part, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a kind never change.
          <Part key={i} part={part} />
        ))}
      </g>
      {label && (
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          fontSize={PLAN_TEXT}
          fontWeight={500}
          fill="currentColor"
          fontFamily="inherit"
        >
          {icon.label}
        </text>
      )}
    </g>
  );
}

/** The dots of the plan's own grid, one every PLAN_GRID view units. */
function GridDots() {
  const id = `plan-grid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      <defs>
        <pattern id={id} width={PLAN_GRID} height={PLAN_GRID} patternUnits="userSpaceOnUse">
          <circle cx={PLAN_GRID / 2} cy={PLAN_GRID / 2} r={2.2} className="plan__dot" />
        </pattern>
      </defs>
      <rect
        x={-PLAN_GRID / 2}
        y={-PLAN_GRID / 2}
        width={PLAN_VIEW_W + PLAN_GRID}
        height={PLAN_VIEW_H + PLAN_GRID}
        fill={`url(#${id})`}
      />
    </>
  );
}

/**
 * A plan's drawing: strokes, then shapes and texts, then set icons, as vectors in the plan's
 * aspect ratio. `grid` shows the dots while editing; `children` draws on top (the live line,
 * the selection). Memoized: it redraws only when the plan changes.
 */
export const PlanDrawing = memo(function PlanDrawing({
  plan,
  grid = false,
  children,
}: {
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>;
  grid?: boolean;
  children?: ReactNode;
}) {
  return (
    <svg
      className="plan__svg"
      viewBox={`0 0 ${PLAN_VIEW_W} ${PLAN_VIEW_H}`}
      style={{ aspectRatio: String(PLAN_ASPECT) }}
      aria-hidden="true"
    >
      {grid && <GridDots />}
      {plan.strokes?.map((s) => (
        <g key={s.id} style={{ color: planCss(s.color) }}>
          <StrokePath stroke={s} height={PLAN_VIEW_H} color="currentColor" />
        </g>
      ))}
      {plan.shapes?.map((s) => (
        <g key={s.id} style={{ color: planCss(s.color) }}>
          <ShapeView shape={s} height={PLAN_VIEW_H} color="currentColor" />
        </g>
      ))}
      {plan.icons?.map((icon) => (
        <PlanIconView key={icon.id} icon={icon} />
      ))}
      {children}
    </svg>
  );
});
