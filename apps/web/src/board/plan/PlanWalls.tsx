// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanOpening,
  addPlanWall,
  atLength,
  DEFAULT_OPENING_METRES,
  DEFAULT_WALL_METRES,
  metresToView,
  moveWallCorner,
  nearestOnWall,
  openingCorners,
  openingLines,
  openingPlace,
  openingSpan,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type Point,
  planWallAt,
  pointAlongWall,
  sideAngle,
  snapWallEnd,
  toWallPoints,
  updatePlanWalls,
  WALL_THICKNESSES,
  type WallAngles,
  wallPoints,
} from '@inkadra/canvas-core';
import {
  MAX_PLAN_OPENINGS,
  MAX_PLAN_WALLS,
  MAX_WALL_POINTS,
  PLAN_OPENING_KINDS,
  type PlanOpening,
  type PlanOpeningKind,
  type PlanWall,
} from '@inkadra/doc-schema';
import { Button, Icon, type IconName } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import { measureValue } from './kit.ts';

/** The icon of each kind of opening, in the palette and the properties. */
export const OPENING_ICONS: Record<PlanOpeningKind, IconName> = {
  door: 'door',
  doubledoor: 'doubleDoor',
  sliding: 'slidingDoor',
  window: 'windowPane',
  opening: 'opening',
};
/** A pointer this close to the first corner (view units) closes the room. */
const CLOSE_SLOP = 14;
/** How far from a wall (view units, past its thickness) the Openings tool still finds it. */
const WALL_SLOP = 14;

const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
const round2 = (v: number) => Math.round(v * 100) / 100;

type WallGesture =
  | { kind: 'corner'; wall: PlanWall; index: number }
  | { kind: 'opening'; wall: PlanWall; opening: PlanOpening };

/** "3.00 m": a length in view units read in metres through the plan's scale. */
export function useMetres(ed: Ed) {
  const { i18n } = useTranslation();
  return (units: number) =>
    `${(units / ed.wallScale).toLocaleString(i18n.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} m`;
}

/** A dimension: a thin line with ticks from a to b, offset by `off`, its length written on it. */
function Dim({
  a,
  b,
  off,
  text,
  strong,
}: {
  a: Point;
  b: Point;
  off: number;
  text: string;
  strong?: boolean;
}) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const pa = { x: a.x + n.x * off, y: a.y + n.y * off };
  const pb = { x: b.x + n.x * off, y: b.y + n.y * off };
  const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  const tick = (p: Point) => `M${p.x - n.x * 5} ${p.y - n.y * 5}L${p.x + n.x * 5} ${p.y + n.y * 5}`;
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return (
    <g className="plan-walls__dim">
      <path d={`M${pa.x} ${pa.y}L${pb.x} ${pb.y}${tick(pa)}${tick(pb)}`} />
      {strong ? (
        <g className="plan-editor__chip" transform={`translate(${m.x} ${m.y}) rotate(${angle})`}>
          <rect x={-30} y={-11} width={60} height={22} rx={6} />
          <text y={5} textAnchor="middle">
            {text}
          </text>
        </g>
      ) : (
        <text
          className="plan-walls__dimtext"
          transform={`translate(${m.x} ${m.y}) rotate(${angle})`}
          y={-5}
          textAnchor="middle"
        >
          {text}
        </text>
      )}
    </g>
  );
}

/** The dimensions of an opening: its width, strong, and its distances to the corners of its side. */
function OpeningDims({
  wall,
  opening,
  metres,
}: {
  wall: PlanWall;
  opening: PlanOpening;
  metres: (v: number) => string;
}) {
  const span = openingSpan(wall, opening);
  const corners = openingCorners(wall, opening);
  const a = pointAlongWall(wall, span.from).point;
  const b = pointAlongWall(wall, span.to).point;
  const start = pointAlongWall(wall, span.from - corners.before).point;
  const end = pointAlongWall(wall, span.to + corners.after).point;
  const off = -(wall.thickness / 2 + 22);
  return (
    <g>
      {corners.before > 0.5 && <Dim a={start} b={a} off={off} text={metres(corners.before)} />}
      <Dim a={a} b={b} off={off} text={metres(span.to - span.from)} strong />
      {corners.after > 0.5 && <Dim a={b} b={end} off={off} text={metres(corners.after)} />}
    </g>
  );
}

/**
 * The Walls and Openings tools of the set plan editor (decision 0109) and the editing of walls
 * with the Select tool: what PlanCanvas asks on each pointer event, the live drawing, the
 * dimensions, and the bars of the tools. Each corner placed, opening placed and drag finished is
 * one change of the document, one undo step.
 */
export function useWallTools(ed: Ed, opts: { snapped: (p: Point) => Point; zoom: number }) {
  const { t } = useTranslation();
  const metres = useMetres(ed);
  const { tool, shown } = ed;
  const [angles, setAngles] = useState<WallAngles>('90');
  const [thickness, setThickness] = useState<number>(DEFAULT_WALL_METRES);
  const [hover, setHover] = useState<Point | null>(null);
  /** The first corner, until the second makes the wall; then the wall being drawn. */
  const [draft, setDraft] = useState<{ start: Point } | { wallId: string } | null>(null);
  /** The length typed for the next side, or the width of the next opening, in metres. */
  const [typed, setTyped] = useState('');
  const gesture = useRef<WallGesture | null>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const k = opts.zoom / 100;
  const walls = shown.walls ?? [];
  const setHidden = ed.hiddenLayers.has('set');
  const active = tool === 'walls' || tool === 'openings';

  const drafted =
    draft && 'wallId' in draft ? (walls.find((w) => w.id === draft.wallId) ?? null) : null;
  // Undone, or removed by someone else: the drawing starts over.
  const corners: Point[] = drafted
    ? wallPoints(drafted)
    : draft && 'start' in draft
      ? [draft.start]
      : [];
  const last = corners.at(-1) ?? null;
  const typedMetres = Number(measureValue(typed) ?? Number.NaN);
  /** Where the side being drawn ends: the pointer along an allowed angle, or the typed length. */
  const sideEnd = (towards: Point): Point | null => {
    if (!last) return null;
    const end = snapWallEnd(last, towards, angles);
    return typedMetres > 0 ? atLength(last, end, typedMetres * ed.wallScale) : end;
  };
  const closes = (p: Point) =>
    !!drafted &&
    !drafted.closed &&
    corners.length >= 3 &&
    Math.hypot(p.x - (corners[0] as Point).x, p.y - (corners[0] as Point).y) <= CLOSE_SLOP / k;
  const thicknessUnits = round2(metresToView(thickness, ed.wallScale));

  // Drawing -------------------------------------------------------------------------------
  const finish = () => {
    setDraft(null);
    setTyped('');
  };
  // Another tool ends the wall being drawn.
  useEffect(() => {
    if (!active) {
      setDraft(null);
      setTyped('');
      setHover(null);
    }
  }, [active]);
  /** Puts the next corner at `at` (view units); the second corner makes the wall. */
  const corner = (at: Point) => {
    if (closes(at) && drafted) {
      ed.writeWalls('walls', [{ ...drafted, closed: true }]);
      finish();
      return;
    }
    if (!last) {
      if ((ed.drawn.walls?.length ?? 0) >= MAX_PLAN_WALLS) return;
      setDraft({ start: at });
      return;
    }
    const end = sideEnd(at) ?? at;
    if (Math.hypot(end.x - last.x, end.y - last.y) < 2) return;
    setTyped('');
    if (!drafted) {
      let id: string | null = null;
      ed.change(() => {
        ed.ensureScale();
        id = addPlanWall(
          ed.doc,
          ed.setOwner,
          { points: toWallPoints([last, end]), thickness: thicknessUnits },
          LOCAL,
        );
      });
      setDraft(id ? { wallId: id } : null);
      return;
    }
    const points = [...drafted.points, ...toWallPoints([end])];
    ed.writeWalls('walls', [{ ...drafted, points }]);
    if (points.length / 2 >= MAX_WALL_POINTS) finish();
  };
  /** The typed length gives the next side, the way the pointer last pointed. */
  const commitTyped = () => {
    if (tool === 'walls' && last && typedMetres > 0) {
      const towards =
        hover ??
        (corners.length > 1
          ? atLength(corners.at(-2) as Point, last, 1e6)
          : { x: last.x + 1, y: last.y });
      corner(sideEnd(towards) ?? towards);
    }
  };

  // Openings ------------------------------------------------------------------------------
  /** The wall under the pointer for the Openings tool, and where the opening would go on it. */
  const openingAt = (p: Point): PlanOpening | null => {
    let best: { wall: PlanWall; distance: number } | null = null;
    for (const wall of walls) {
      const near = nearestOnWall(wall, p);
      if (
        near.distance <= wall.thickness / 2 + WALL_SLOP / k &&
        (!best || near.distance < best.distance)
      )
        best = { wall, distance: near.distance };
    }
    if (!best) return null;
    const kind = ed.openingKind;
    const width =
      typedMetres > 0
        ? typedMetres * ed.wallScale
        : metresToView(DEFAULT_OPENING_METRES[kind], ed.wallScale);
    return {
      id: 'ghostAAAAAAAA',
      wall: best.wall.id,
      kind,
      at: round2(openingPlace(best.wall, p, width)),
      width: round2(width),
    };
  };
  const ghost = tool === 'openings' && hover && !setHidden ? openingAt(hover) : null;

  // Pointer events from the canvas ---------------------------------------------------------
  /** A press with the Walls or Openings tool; true when it was theirs. */
  const down = (p01: Point): boolean => {
    if (!active) return false;
    if (ed.setLocked || setHidden) return true;
    const p = view(p01);
    if (tool === 'walls') corner(last ? p : view(opts.snapped(p01)));
    else {
      const placed = openingAt(p);
      if (!placed || (ed.drawn.openings?.length ?? 0) >= MAX_PLAN_OPENINGS) return true;
      const { id: _ghost, ...fresh } = placed;
      ed.change(() => addPlanOpening(ed.doc, ed.setOwner, fresh, LOCAL));
      setTyped('');
    }
    return true;
  };
  /** A press with the Select tool on a wall, an opening or a corner handle; true when taken. */
  const pick = (p01: Point, target: Element): boolean => {
    if (setHidden) return false;
    const handle = target.closest<SVGElement>('[data-corner]');
    const picked = ed.wallSel;
    if (handle && picked?.kind === 'walls') {
      const wall = walls.find((w) => w.id === picked.id);
      if (wall) {
        ed.store.undo.stopCapturing();
        gesture.current = { kind: 'corner', wall, index: Number(handle.dataset.corner) };
        return true;
      }
    }
    const hit = planWallAt(shown, view(p01), 4 / k);
    if (!hit) return false;
    if (ed.setLocked) {
      ed.selectWall(null);
      ed.setLockedWall(true);
      return true;
    }
    ed.selectWall(hit);
    if (hit.kind === 'openings') {
      const opening = shown.openings?.find((o) => o.id === hit.id);
      const wall = opening && walls.find((w) => w.id === opening.wall);
      if (opening && wall) gesture.current = { kind: 'opening', wall, opening };
    }
    return true;
  };
  /** The pointer moving: the live side, the opening under it, or a drag. */
  const move = (p01: Point): boolean => {
    const p = view(p01);
    const g = gesture.current;
    if (g?.kind === 'corner') {
      const to = view(opts.snapped(p01));
      const next = moveWallCorner(g.wall, g.index, to, shown.openings ?? []);
      ed.setWallPreview({ walls: [next.wall], openings: next.openings });
      return true;
    }
    if (g?.kind === 'opening') {
      const at = round2(openingPlace(g.wall, p, g.opening.width));
      ed.setWallPreview({ openings: [{ ...g.opening, at }] });
      return true;
    }
    if (active) setHover(p);
    return false;
  };
  /** The end of a drag: written as one change. */
  const up = (): boolean => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return false;
    const next = ed.wallPreview;
    ed.setWallPreview(null);
    if (!next) return true;
    ed.change(() => {
      if (next.walls) updatePlanWalls(ed.doc, ed.setOwner, 'walls', next.walls, LOCAL);
      if (next.openings?.length)
        updatePlanWalls(ed.doc, ed.setOwner, 'openings', next.openings, LOCAL);
    });
    return true;
  };
  const cancel = () => {
    gesture.current = null;
    ed.setWallPreview(null);
  };
  /** Escape: the typed length first, then the wall being drawn. True when it closed something. */
  const onEscape = (): boolean => {
    if (typed) setTyped('');
    else if (draft) finish();
    else return false;
    return true;
  };
  /** Digits typed on the plan go to the length field of the tool. */
  const key = (e: KeyboardEvent): boolean => {
    if (!active || !/^[\d.,]$/.test(e.key)) return false;
    typedRef.current?.focus();
    setTyped((v) => v + e.key);
    return true;
  };
  const done = () => {
    finish();
    setHover(null);
    ed.setTool('select');
  };

  // Drawing on the plan ----------------------------------------------------------------------
  const end = active && tool === 'walls' && hover ? sideEnd(hover) : null;
  const before = corners.length > 1 ? corners.at(-2) : undefined;
  const live = last && end && (
    <g className="plan-walls__live">
      <line
        x1={last.x}
        y1={last.y}
        x2={end.x}
        y2={end.y}
        strokeWidth={thicknessUnits}
        className="plan-walls__side"
      />
      <Dim
        a={last}
        b={end}
        off={thicknessUnits / 2 + 22}
        text={metres(Math.hypot(end.x - last.x, end.y - last.y))}
        strong
      />
      <text className="plan-walls__angle" x={last.x + 14} y={last.y - 12}>
        {`${sideAngle(last, end, before)}°`}
      </text>
    </g>
  );
  const firstCorner = corners[0];
  const closer = tool === 'walls' &&
    drafted &&
    !drafted.closed &&
    corners.length >= 3 &&
    firstCorner && (
      <g className="plan-walls__close">
        <circle cx={firstCorner.x} cy={firstCorner.y} r={CLOSE_SLOP / k} />
        <text x={firstCorner.x} y={firstCorner.y + CLOSE_SLOP / k + 16} textAnchor="middle">
          {t(ed.phone ? 'board.plan.walls.closeTap' : 'board.plan.walls.closeClick')}
        </text>
      </g>
    );
  const dot = last && tool === 'walls' && (
    <circle className="plan-walls__dot" cx={last.x} cy={last.y} r={5 / k} />
  );
  const ghostWall = ghost && walls.find((w) => w.id === ghost.wall);
  const ghostView = ghost && ghostWall && (
    <g className="plan-walls__ghost">
      {openingLines(ghostWall, ghost).map((line, i) => (
        <polyline
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one opening, in order.
          key={i}
          points={line.points.map((q) => `${q.x},${q.y}`).join(' ')}
          strokeDasharray={line.dashed ? '4 4' : undefined}
        />
      ))}
      <OpeningDims wall={ghostWall} opening={ghost} metres={metres} />
    </g>
  );
  // The picked wall: its corners to drag and the length of each side; the picked opening: its
  // width and distances.
  const picked = ed.wallSel;
  const pickedWall = picked?.kind === 'walls' ? walls.find((w) => w.id === picked.id) : undefined;
  const pickedOpening =
    picked?.kind === 'openings' ? shown.openings?.find((o) => o.id === picked.id) : undefined;
  const openingWall = pickedOpening && walls.find((w) => w.id === pickedOpening.wall);
  const grip = (ed.phone ? 22 : 10) / k;
  const selection = (
    <>
      {pickedWall && (
        <g className="plan-walls__picked">
          {(() => {
            const pts = wallPoints(pickedWall);
            const sides = pts.slice(1).map((b, i) => [pts[i] as Point, b] as const);
            if (pickedWall.closed && pts.length > 2)
              sides.push([pts.at(-1) as Point, pts[0] as Point]);
            return sides.map(([a, b], i) => (
              <Dim
                // biome-ignore lint/suspicious/noArrayIndexKey: a side is its place in the wall.
                key={i}
                a={a}
                b={b}
                off={-(pickedWall.thickness / 2 + 18)}
                text={metres(Math.hypot(b.x - a.x, b.y - a.y))}
              />
            ));
          })()}
          {wallPoints(pickedWall).map((q, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: a corner is its place in the wall.
              key={i}
              data-corner={i}
              className="plan-editor__handle plan-walls__corner"
              x={q.x - grip / 2}
              y={q.y - grip / 2}
              width={grip}
              height={grip}
              rx={grip / 2}
            />
          ))}
        </g>
      )}
      {pickedOpening && openingWall && (
        <OpeningDims wall={openingWall} opening={pickedOpening} metres={metres} />
      )}
    </>
  );
  const overlay = (
    <>
      {selection}
      {ghostView}
      {live}
      {closer}
      {dot}
    </>
  );

  // The bars of the tools ------------------------------------------------------------------
  const cm = (m: number) => `${Math.round(m * 100)} cm`;
  const options = active && (
    <div
      className="plan-float plan-walls__options"
      role="toolbar"
      aria-label={t('board.plan.walls.options')}
    >
      <span className="plan-prop__label">{t('board.plan.walls.thickness')}</span>
      {WALL_THICKNESSES.map((m) => (
        <button
          key={m}
          type="button"
          className="plan-pill"
          aria-pressed={thickness === m}
          onClick={() => setThickness(m)}
        >
          {cm(m)}
        </button>
      ))}
      <span className="plan-float__sep" aria-hidden="true" />
      <span className="plan-prop__label">{t('board.plan.walls.angles')}</span>
      {(['90', '45', 'free'] as const).map((a) => (
        <button
          key={a}
          type="button"
          className="plan-pill"
          aria-pressed={angles === a}
          onClick={() => setAngles(a)}
        >
          {a === 'free' ? t('board.plan.walls.free') : `${a}°`}
        </button>
      ))}
      <span className="plan-float__sep" aria-hidden="true" />
      <input
        ref={typedRef}
        className="plan-walls__typed"
        inputMode="decimal"
        aria-label={t(
          tool === 'openings' ? 'board.plan.walls.typedWidth' : 'board.plan.walls.typedLength',
        )}
        placeholder={t('board.plan.walls.typeHint')}
        value={typed}
        onChange={(e) => setTyped(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTyped();
            if (tool === 'walls') e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setTyped('');
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
  const doneButton = (
    <Button variant="primary" onClick={done}>
      {t('board.plan.walls.done')}
    </Button>
  );
  const palette = active && (
    <div
      className="plan-float plan-walls__palette"
      role="toolbar"
      aria-label={t('board.plan.walls.openings')}
    >
      <span className="plan-props__cap">{t('board.plan.walls.openings')}</span>
      {PLAN_OPENING_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="plan-tool"
          aria-pressed={tool === 'openings' && ed.openingKind === kind}
          onClick={() => {
            finish();
            ed.setOpeningKind(kind);
            ed.setTool('openings');
          }}
        >
          <Icon name={OPENING_ICONS[kind]} size={18} />
          <span>{t(`board.plan.walls.kinds.${kind}`)}</span>
        </button>
      ))}
      {/* On a phone the bar of the selection is gone: Done ends here. */}
      {ed.phone && doneButton}
    </div>
  );
  const lockedNote = active && (ed.setLocked || setHidden) && (
    <p className="plan-float plan-canvas__toast" role="status">
      {t(ed.setLocked ? 'board.plan.walls.locked' : 'board.plan.walls.hidden')}
    </p>
  );
  return {
    down,
    pick,
    move,
    up,
    cancel,
    escape: onEscape,
    key,
    done,
    overlay,
    options,
    palette,
    lockedNote,
    doneButton,
    active,
  };
}

export type WallTools = ReturnType<typeof useWallTools>;

/** What the plan holds on its Set layer besides items: "Walls, 2 windows, a door". */
export function setSummary(
  plan: { walls?: PlanWall[] | undefined; openings?: PlanOpening[] | undefined },
  t: TFunction,
): string {
  const parts: string[] = [];
  const walls = plan.walls?.length ?? 0;
  if (walls) parts.push(t('board.plan.walls.summaryWalls', { count: walls }));
  const counts = new Map<PlanOpeningKind, number>();
  for (const o of plan.openings ?? []) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  for (const kind of PLAN_OPENING_KINDS) {
    const n = counts.get(kind);
    if (n) parts.push(t(`board.plan.walls.summary.${kind}`, { count: n }));
  }
  return parts.join(', ');
}

/** The thickness of a wall in centimetres at the plan's scale. */
export const wallCentimetres = (wall: Pick<PlanWall, 'thickness'>, scale: number) =>
  Math.round((wall.thickness / scale) * 100);
