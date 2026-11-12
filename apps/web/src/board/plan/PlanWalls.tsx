// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanOpening,
  addPlanWall,
  CLOSE_SLOP,
  canCloseWall,
  DEFAULT_WALL_METRES,
  draftCorners,
  dragOpening,
  itemLocked,
  moveWallCorner,
  openingAt,
  openingCorners,
  openingLines,
  openingSpan,
  outside,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type Point,
  planRooms,
  planWallAt,
  pointAlongWall,
  roomDims,
  sideAngle,
  typedTowards,
  updatePlanWalls,
  viewToMetres,
  WALL_THICKNESSES,
  type WallAngles,
  type WallDraft,
  wallPoints,
  wallSideEnd,
  wallStep,
  wallThickness,
} from '@inkadra/canvas-core';
import {
  MAX_PLAN_OPENINGS,
  PLAN_OPENING_KINDS,
  type PlanOpening,
  type PlanOpeningKind,
  type PlanWall,
} from '@inkadra/doc-schema';
import { Button, Icon, type IconName } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import { measureValue } from './kit.ts';
import { RoomDimView, roomSizeText } from './PlanDrawing.tsx';

/** The icon of each kind of opening, in the palette and the properties. */
export const OPENING_ICONS: Record<PlanOpeningKind, IconName> = {
  door: 'door',
  doubledoor: 'doubleDoor',
  sliding: 'slidingDoor',
  window: 'windowPane',
  opening: 'opening',
};
const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });

type WallGesture =
  | { kind: 'corner'; wall: PlanWall; index: number; openings: PlanOpening[] }
  | { kind: 'opening'; wall: PlanWall; opening: PlanOpening };

/** "3.00 m" (or "8.0 m" with one digit): a length in view units, in metres at the plan's scale. */
export function useMetres(ed: Ed, digits = 2) {
  const { i18n } = useTranslation();
  return (units: number) =>
    `${viewToMetres(units, ed.wallScale).toLocaleString(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
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
  const off = outside(wall) * (wall.thickness / 2 + 22);
  return (
    <g>
      {corners.before > 0.5 && <Dim a={start} b={a} off={off} text={metres(corners.before)} />}
      <Dim a={a} b={b} off={off} text={metres(span.to - span.from)} strong />
      {corners.after > 0.5 && <Dim a={b} b={end} off={off} text={metres(corners.after)} />}
    </g>
  );
}

/**
 * The Walls and Openings tools of the set plan editor (decision 0110) and the editing of walls
 * with the Select tool: what PlanCanvas asks on each pointer event, the live drawing, the
 * dimensions, and the bars of the tools. Each corner placed, opening placed and drag finished is
 * one change of the document, one undo step.
 */
export function useWallTools(ed: Ed, opts: { snapped: (p: Point) => Point; zoom: number }) {
  const { t, i18n } = useTranslation();
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
  const drawing: WallDraft = drafted
    ? { wall: drafted }
    : draft && 'start' in draft
      ? { start: draft.start }
      : null;
  const corners = draftCorners(drawing);
  const last = corners.at(-1) ?? null;
  const typedMetres = Number(measureValue(typed) ?? Number.NaN);
  /** Where the side being drawn ends: the pointer along an allowed angle, or the typed length. */
  const sideEnd = (towards: Point): Point | null =>
    last ? wallSideEnd(last, towards, angles, typedMetres, ed.wallScale) : null;
  const thicknessUnits = wallThickness(thickness, ed.wallScale);

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
    const step = wallStep(drawing, at, {
      angles,
      typedMetres,
      thickness,
      scale: ed.wallScale,
      zoom: opts.zoom,
      walls: ed.drawn.walls?.length ?? 0,
    });
    if (!step) return;
    if (step.kind === 'close') {
      ed.writeWalls('walls', [step.wall]);
      finish();
      return;
    }
    if (step.kind === 'start') {
      setDraft({ start: step.at });
      return;
    }
    setTyped('');
    if (step.kind === 'add') {
      let id: string | null = null;
      ed.change(() => {
        ed.ensureScale();
        id = addPlanWall(ed.doc, ed.setOwner, step.wall, LOCAL);
      });
      setDraft(id ? { wallId: id } : null);
      return;
    }
    ed.writeWalls('walls', [step.wall]);
    if (step.full) finish();
  };
  /** The typed length gives the next side, the way the pointer last pointed. */
  const commitTyped = () => {
    const towards = typedTowards(corners, hover);
    if (tool === 'walls' && towards && typedMetres > 0) corner(sideEnd(towards) ?? towards);
  };

  // Openings ------------------------------------------------------------------------------
  /** The wall under the pointer for the Openings tool, and where the opening would go on it. */
  const placing = (p: Point) =>
    openingAt(walls, p, ed.openingKind, { typedMetres, scale: ed.wallScale, zoom: opts.zoom });
  const ghostAt = tool === 'openings' && hover && !setHidden ? placing(hover) : null;
  const ghost: PlanOpening | null = ghostAt && { id: 'ghostAAAAAAAA', ...ghostAt };

  // Pointer events from the canvas ---------------------------------------------------------
  /** A press with the Walls or Openings tool; true when it was theirs. */
  const down = (p01: Point): boolean => {
    if (!active) return false;
    if (ed.setLocked || setHidden) return true;
    const p = view(p01);
    if (tool === 'walls') corner(last ? p : view(opts.snapped(p01)));
    else {
      const placed = placing(p);
      if (!placed || (ed.drawn.openings?.length ?? 0) >= MAX_PLAN_OPENINGS) return true;
      ed.change(() => addPlanOpening(ed.doc, ed.setOwner, placed, LOCAL));
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
      // As stored when the drag starts: each move is computed from them, never from the last
      // move's preview, so the openings do not creep along the wall.
      const wall = ed.drawn.walls?.find((w) => w.id === picked.id);
      if (wall && !itemLocked(wall)) {
        ed.store.undo.stopCapturing();
        gesture.current = {
          kind: 'corner',
          wall,
          index: Number(handle.dataset.corner),
          openings: (ed.drawn.openings ?? []).filter((o) => o.wall === wall.id),
        };
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
      // A locked opening is picked, not dragged (decision 0114).
      if (opening && wall && !itemLocked(opening))
        gesture.current = { kind: 'opening', wall, opening };
    }
    return true;
  };
  /** The pointer moving: the live side, the opening under it, or a drag. */
  const move = (p01: Point): boolean => {
    const p = view(p01);
    const g = gesture.current;
    if (g?.kind === 'corner') {
      const to = view(opts.snapped(p01));
      const next = moveWallCorner(g.wall, g.index, to, g.openings);
      ed.setWallPreview({ walls: [next.wall], openings: next.openings });
      return true;
    }
    if (g?.kind === 'opening') {
      ed.setWallPreview({ openings: [dragOpening(g.wall, g.opening, p)] });
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
  const closer = tool === 'walls' && canCloseWall(drafted) && firstCorner && (
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
  // The room the picked wall is part of: a closed wall, or open walls closing a loop (0119).
  const rooms = pickedWall ? planRooms(walls) : [];
  const pickedRoom = pickedWall && rooms.find((r) => r.walls.includes(pickedWall.id));
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
                off={outside(pickedWall) * (pickedWall.thickness / 2 + 18)}
                text={metres(Math.hypot(b.x - a.x, b.y - a.y))}
              />
            ));
          })()}
          {/* A picked room's size: the drawing leaves its own out while a wall is picked. */}
          {pickedRoom && (
            <g className="plan-walls__room" data-room-dims="">
              {roomDims(pickedRoom, walls, rooms).map((d) => (
                <RoomDimView
                  key={`${d.a.x},${d.a.y}`}
                  dim={d}
                  text={roomSizeText(d.length, ed.wallScale, d.overall, t, i18n.language)}
                />
              ))}
            </g>
          )}
          {!itemLocked(pickedWall) &&
            wallPoints(pickedWall).map((q, i) => (
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
          aria-label={t(`board.plan.walls.kinds.${kind}`)}
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
