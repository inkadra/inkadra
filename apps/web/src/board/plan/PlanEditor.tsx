// SPDX-License-Identifier: AGPL-3.0-only
import {
  addBlockingStep,
  addPlanIcon,
  addShape,
  addStroke,
  bendThrough,
  blockingCurve,
  blockingPositions,
  categoryOf,
  DEFAULT_LENS,
  duplicatePlanItems,
  encodeStroke,
  gridStep,
  iconCone,
  itemBox,
  itemFrame,
  layerOf,
  moveItem,
  normalizeRotation,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanItem,
  type PlanItemRef,
  type PlanNoteTool,
  type Point,
  planItem,
  planItemAt,
  type ResizeHandle,
  ROTATE_STEP,
  removePlanItems,
  resizeItem,
  rotateItem,
  type SceneElement,
  shownAngle,
  snapPlanPoint,
  toGrid,
  updateElement,
  updatePlanItems,
} from '@inkadra/canvas-core';
import {
  type FrameShape,
  MAX_PLAN_ICONS,
  MAX_SHAPES,
  MAX_STROKES,
  PLAN_ICON_KINDS,
  type PlanIcon,
  type PlanIconKind,
  type PlanSensor,
  type PlanShape,
  type PlanStep,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName, Select, Switch } from '@inkadra/ui';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { pathOf } from '../film/strokes.ts';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { NumberField } from './NumberField.tsx';
import { planTitle } from './PlanCard.tsx';
import {
  iconColor,
  NOTE_COLOR,
  PLAN_COLORS,
  PLAN_INK,
  PLAN_PEN,
  PLAN_TEXT,
  PlanDrawing,
  PlanGlyph,
  PlanShapeView,
  planCss,
  TEXT_SIZES,
} from './PlanDrawing.tsx';
import { type LibraryItem, PlanLibrary, rememberRecent } from './PlanLibrary.tsx';
import { SceneBadges, ScenePicker, scenesOfPlan } from './scenes.tsx';
import './plan.css';

type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'zone' | 'measure';
type Tool = 'select' | 'pencil' | 'text' | 'icons' | 'move' | DragKind;
type Panel = 'icons' | 'props';

/** The tools of the frame drawing that plans use, in the order of the mockup, with their keys. */
const TOOLS: Array<{ tool: Tool; icon: IconName; key: string; phone: boolean }> = [
  { tool: 'select', icon: 'pointer', key: 'V', phone: true },
  { tool: 'pencil', icon: 'pen', key: 'P', phone: true },
  { tool: 'line', icon: 'line', key: 'L', phone: false },
  { tool: 'arrow', icon: 'arrow', key: 'A', phone: true },
  { tool: 'rect', icon: 'rect', key: 'Q', phone: true },
  { tool: 'ellipse', icon: 'ellipse', key: 'O', phone: false },
  { tool: 'text', icon: 'text', key: 'T', phone: true },
];
const KINDS = new Set<string>(PLAN_ICON_KINDS);
/** A set of primes, as on the mockup; Other takes any focal length. */
const LENSES = [18, 24, 35, 50, 85, 135];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_SIGN: Record<ResizeHandle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};
const isIconKind = (item: LibraryItem): item is PlanIconKind => KINDS.has(item);

interface TextDraft {
  at: Point;
  value: string;
  color: string;
}
type Gesture =
  | { kind: 'move'; ref: PlanItemRef; start: Point; item: PlanItem }
  | { kind: 'rotate'; ref: PlanItemRef; centre: Point; from: number; item: PlanItem }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'shape'; shape: DragKind; a: Point; b: Point }
  | { kind: 'bend'; index: number; item: PlanIcon }
  | { kind: 'resize'; handle: ResizeHandle; item: PlanItem }
  | { kind: 'end'; which: 0 | 1; item: PlanShape };

/** View units of a point of the drawing (0 to 1). */
const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
const isIcon = (item: PlanItem | null | undefined): item is PlanIcon => !!item && 'x' in item;

const replaceIn = <T extends { id: string }>(
  list: T[] | undefined,
  next: PlanItem,
): T[] | undefined => list?.map((item) => (item.id === next.id ? (next as unknown as T) : item));

/**
 * The editor of a set plan (#335): a window in front of the dimmed board, on a desktop with
 * the tools on its left, the icon library and the properties on its right and the bar of the
 * selected item under the plan; on a phone it takes the whole screen with the library as a
 * sheet from the bottom. Every finished line, shape, icon or edit is one change of the
 * document, so it syncs as you go and undo goes back one gesture at a time. The tool, the
 * selection and the grid snap are local to this person.
 */
export function PlanEditor({
  store,
  plan,
  phone,
  scenes,
  lenses = [],
  onOpenScene,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  phone: boolean;
  /** Scenes of the board, in shooting order, to link the plan to. */
  scenes: readonly SceneElement[];
  /** Lenses of the frames of the plan's scenes, proposed for a camera ("5A · 35 mm"). */
  lenses?: ReadonlyArray<{ label: string; mm: number }>;
  onOpenScene: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<LibraryItem | null>(null);
  const [panel, setPanel] = useState<Panel>('icons');
  const [snap, setSnap] = useState(true);
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null);
  const [otherLens, setOtherLens] = useState(false);
  /** The icon whose blocking is being drawn with the Movement tool, and the veiled copies. */
  const [moving, setMoving] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState(true);
  /** The angle shown over the rotate handle while it turns. */
  const [chip, setChip] = useState<string | null>(null);
  const linked = scenesOfPlan(plan, new Map(scenes.map((s) => [s.id, s])));
  const [selected, setSelected] = useState<PlanItemRef | null>(null);
  /** The item being moved or turned, shown in place until the gesture ends. */
  const [preview, setPreviewState] = useState<PlanItem | null>(null);
  // The pointer-up handler reads the preview of the last move, which may not be rendered yet.
  const previewRef = useRef<PlanItem | null>(null);
  const setPreview = (next: PlanItem | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };
  const [live, setLive] = useState<Point[] | null>(null);
  const [liveShape, setLiveShape] = useState<{ kind: DragKind; a: Point; b: Point } | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const doc = store.doc;
  const step = gridStep(plan);
  /** Annotations from the library draw green; the tools of the column draw in ink. */
  const ink = armed && !isIconKind(armed) ? NOTE_COLOR : PLAN_INK;
  const viewOf = {
    hidden: new Set(plan.hiddenLayers ?? []),
    locked: new Set(plan.lockedLayers ?? []),
  };
  const item = selected ? planItem(plan, selected) : undefined;
  const movingIcon = (plan.icons ?? []).find((i) => i.id === moving) ?? null;
  const shown =
    preview === null
      ? plan
      : {
          ...plan,
          strokes: replaceIn(plan.strokes, preview),
          shapes: replaceIn(plan.shapes, preview),
          icons: replaceIn(plan.icons, preview),
        };
  const current = (preview && preview.id === item?.id ? preview : item) ?? null;

  // The selection goes when its item does (deleted here, by undo or by someone else).
  useEffect(() => {
    if (selected && !item) setSelected(null);
  }, [selected, item]);
  useEffect(() => {
    if (text) textInput.current?.focus();
  }, [text]);
  // Another tool ends the movement being drawn.
  useEffect(() => {
    if (tool !== 'move') setMoving(null);
  }, [tool]);

  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
  };
  const snapped = (p: Point) => (snap ? snapPlanPoint(p, step) : p);
  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

  const placeIcon = (kind: PlanIconKind, p: Point) => {
    if ((plan.icons?.length ?? 0) >= MAX_PLAN_ICONS) return;
    const q = snapped(p);
    let id: string | null = null;
    change(() => {
      id = addPlanIcon(
        doc,
        plan.id,
        { kind, color: iconColor(kind), x: toGrid(q.x), y: toGrid(q.y) },
        LOCAL,
      );
    });
    rememberRecent(kind);
    if (id) setSelected({ kind: 'icons', id });
  };

  /** A library tile: icons wait for a tap on the plan; annotations pick their tool. */
  const arm = (next: LibraryItem) => {
    setArmed(next);
    setSelected(null);
    if (isIconKind(next)) setTool('icons');
    else {
      rememberRecent(next);
      setTool(TOOL_OF_NOTE[next]);
    }
  };
  const dropAt = (next: LibraryItem, at: { clientX: number; clientY: number }) => {
    const p = pointAt(at);
    if (isIconKind(next) && inside(p)) placeIcon(next, p);
  };

  const remove = () => {
    if (!selected) return;
    change(() => removePlanItems(doc, plan.id, [selected.id], LOCAL));
    setSelected(null);
  };
  const duplicate = () => {
    if (!selected) return;
    let copies: PlanItemRef[] = [];
    change(() => {
      copies = duplicatePlanItems(doc, plan, [selected], { x: step, y: step }, LOCAL);
    });
    if (copies[0]) setSelected(copies[0]);
  };
  const write = (next: PlanItem) => change(() => updatePlanItems(doc, plan.id, [next], LOCAL));
  const rotate = (degrees: number) => item && write(rotateItem(item, degrees));
  const recolor = (hex: string) => item && write({ ...item, color: hex });
  const relabel = (label: string) => {
    if (!isIcon(item)) return;
    const next = { ...item, label: label.slice(0, 60) };
    if (!label) delete (next as Partial<PlanIcon>).label;
    updatePlanItems(doc, plan.id, [next], LOCAL);
  };

  const commitText = () => {
    const draft = textRef.current;
    textRef.current = null;
    setText(null);
    const value = draft?.value.trim().slice(0, 500);
    if (!draft || !value) return;
    const x = toGrid(draft.at.x);
    const y = toGrid(draft.at.y);
    change(() =>
      addShape(
        doc,
        plan.id,
        {
          kind: 'text',
          color: draft.color,
          width: PLAN_TEXT,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          text: value,
        },
        LOCAL,
      ),
    );
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // The scene picker has the keyboard while it is open.
    if (picking || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (moving) setMoving(null);
      else if (armed) {
        setArmed(null);
        setTool('select');
      } else if (selected) setSelected(null);
      else if (tool !== 'select') setTool('select');
      else onClose();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove();
    else if (mod && key === 'z') e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y') store.undo.redo();
    else if (mod && key === 'd' && selected) duplicate();
    else if (!mod && key === 'r' && selected) rotate(e.shiftKey ? -ROTATE_STEP : ROTATE_STEP);
    else if (!mod && key === '/' && !phone) {
      setPanel('icons');
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.plan-lib__search input')?.focus(),
      );
    } else if (!mod && key === 'g') setSnap((v) => !v);
    else if (!mod && key === 'm') {
      setArmed(null);
      setTool('move');
    } else if (!mod && TOOLS.some((x) => x.key.toLowerCase() === key)) {
      setArmed(null);
      setTool(TOOLS.find((x) => x.key.toLowerCase() === key)?.tool ?? 'select');
    } else return;
    // The canvas behind listens on window too: the editor has these keys while open.
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.plan-editor__text')) return;
    e.stopPropagation();
    const p = pointAt(e);
    if (text) {
      // A click away from the text being typed finishes it.
      commitText();
      return;
    }
    const grip = (e.target as Element).closest<SVGElement>('[data-handle]');
    if (grip && item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      store.undo.stopCapturing();
      gesture.current = { kind: 'resize', handle: grip.dataset.handle as ResizeHandle, item };
      return;
    }
    const end = (e.target as Element).closest<SVGElement>('[data-end]');
    if (end && item && 'x0' in item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'end', which: end.dataset.end === '1' ? 1 : 0, item };
      return;
    }
    const bend = (e.target as Element).closest<SVGElement>('[data-bend]');
    if (bend && isIcon(item)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'bend', index: Number(bend.dataset.bend), item };
      return;
    }
    if (tool === 'move') {
      const hit = planItemAt(plan, p, viewOf);
      const target = hit && planItem(plan, hit);
      if (hit && isIcon(target)) {
        setSelected(hit);
        setMoving(target.id);
        setPanel('props');
      } else if (movingIcon) write(addBlockingStep(movingIcon, snapped(p)));
      return;
    }
    const handle = (e.target as Element).closest('[data-rotate]');
    if (handle && item && selected) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = itemBox(item);
      const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const q = view(p);
      gesture.current = {
        kind: 'rotate',
        ref: selected,
        centre,
        from: Math.atan2(q.y - centre.y, q.x - centre.x),
        item,
      };
      return;
    }
    if (tool === 'select' || tool === 'icons') {
      const hit = planItemAt(plan, p, viewOf);
      if (hit) {
        const target = planItem(plan, hit);
        setSelected(hit);
        // Picked with the arrow, a camera or a light shows its lens or beam (round 6, c).
        if (tool === 'select' && !phone && isIcon(target) && iconCone(target)) setPanel('props');
        if (!target) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        store.undo.stopCapturing();
        gesture.current = { kind: 'move', ref: hit, start: p, item: target };
        return;
      }
      if (tool === 'icons' && armed && isIconKind(armed)) placeIcon(armed, p);
      else setSelected(null);
      return;
    }
    setSelected(null);
    if (tool === 'text') {
      if ((plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
      e.preventDefault();
      const draft = { at: p, value: '', color: ink };
      textRef.current = draft;
      setText(draft);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pencil') {
      if ((plan.strokes?.length ?? 0) >= MAX_STROKES) return;
      gesture.current = { kind: 'draw', points: [p] };
      setLive([p]);
      return;
    }
    if ((plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
    const a = snapped(p);
    gesture.current = { kind: 'shape', shape: tool, a, b: a };
    setLiveShape({ kind: tool, a, b: a });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = pointAt(e);
    if (g.kind === 'move') {
      let d = { x: view(p).x - view(g.start).x, y: view(p).y - view(g.start).y };
      if (snap && isIcon(g.item)) {
        // An icon's centre lands on the grid.
        const c = { x: (g.item.x / 4096) * PLAN_VIEW_W, y: (g.item.y / 4096) * PLAN_VIEW_H };
        const to = snapPlanPoint(
          { x: (c.x + d.x) / PLAN_VIEW_W, y: (c.y + d.y) / PLAN_VIEW_H },
          step,
        );
        d = { x: view(to).x - c.x, y: view(to).y - c.y };
      }
      setPreview(moveItem(g.item, d));
    } else if (g.kind === 'resize') {
      const symbol = isIcon(g.item) && !categoryOf(g.item.kind).sized;
      setPreview(
        resizeItem(g.item, g.handle, view(p), {
          keepRatio: e.shiftKey || symbol,
          fromCentre: e.altKey,
          textSizes: Object.values(TEXT_SIZES),
        }),
      );
    } else if (g.kind === 'end') {
      const q = snapped(p);
      const next: PlanShape =
        g.which === 0
          ? { ...g.item, x0: toGrid(q.x), y0: toGrid(q.y) }
          : { ...g.item, x1: toGrid(q.x), y1: toGrid(q.y) };
      // A measure's end let go anywhere no longer follows its icon.
      delete next[g.which === 0 ? 'from' : 'to'];
      setPreview(next);
    } else if (g.kind === 'bend') {
      const at = blockingPositions(g.item);
      const a = at[g.index] as Point;
      const b = at[g.index + 1] as Point;
      const steps = [...(g.item.steps ?? [])];
      steps[g.index] = {
        ...(steps[g.index] as PlanStep),
        bend: Math.round(bendThrough(a, b, view(p))),
      };
      setPreview({ ...g.item, steps });
    } else if (g.kind === 'rotate') {
      const q = view(p);
      const angle = Math.atan2(q.y - g.centre.y, q.x - g.centre.x);
      let degrees = ((angle - g.from) * 180) / Math.PI;
      if (snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      const turned = rotateItem(g.item, normalizeRotation(degrees));
      setPreview(turned);
      setChip(`${shownAngle(turned)}°`);
    } else if (g.kind === 'draw') {
      // Coalesced events keep fast lines smooth on pens and fast mice.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length > 0 ? events : [e.nativeEvent]) g.points.push(pointAt(ev));
      setLive([...g.points]);
    } else {
      g.b = snapped(p);
      setLiveShape({ kind: g.shape, a: g.a, b: g.b });
    }
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind !== 'draw' && g.kind !== 'shape') {
      setChip(null);
      const next = previewRef.current;
      setPreview(null);
      if (next) write(next);
      return;
    }
    if (g.kind === 'draw') {
      setLive(null);
      change(() =>
        addStroke(
          doc,
          plan.id,
          { tool: 'pencil', color: ink, width: PLAN_PEN, points: encodeStroke(g.points) },
          LOCAL,
        ),
      );
      return;
    }
    setLiveShape(null);
    const shape = {
      kind: g.shape,
      color: ink,
      width: PLAN_PEN,
      x0: toGrid(g.a.x),
      y0: toGrid(g.a.y),
      x1: toGrid(g.b.x),
      y1: toGrid(g.b.y),
      ...(g.shape === 'zone' || g.shape === 'measure' ? { layer: 'notes' as const } : {}),
    };
    // A click without a drag draws nothing.
    if (Math.abs(shape.x1 - shape.x0) + Math.abs(shape.y1 - shape.y0) >= 8)
      change(() => addShape(doc, plan.id, shape as unknown as FrameShape, LOCAL));
  }

  const box = current ? itemBox(current) : null;
  const frame = current ? itemFrame(current) : null;
  const pad = 8;
  const symbol = isIcon(current) && !categoryOf(current.kind).sized;
  const ends =
    current && 'x0' in current && !frame
      ? [
          { x: current.x0 * (PLAN_VIEW_W / 4096), y: current.y0 * (PLAN_VIEW_H / 4096) },
          { x: current.x1 * (PLAN_VIEW_W / 4096), y: current.y1 * (PLAN_VIEW_H / 4096) },
        ]
      : null;
  const rotateGrip = (x: number, y: number) => (
    <g data-rotate="" className="plan-editor__rotate">
      <line x1={x} y1={y} x2={x} y2={y - 32} />
      <circle cx={x} cy={y - 40} r={12} />
      {chip && (
        <g className="plan-editor__chip">
          <rect x={x - 30} y={y - 92} width={60} height={28} rx={6} />
          <text x={x} y={y - 72} textAnchor="middle">
            {chip}
          </text>
        </g>
      )}
    </g>
  );
  const selection =
    box &&
    (frame ? (
      <g
        className="plan-editor__selection"
        transform={`translate(${frame.centre.x} ${frame.centre.y}) rotate(${frame.angle})`}
      >
        <rect
          x={-frame.w / 2 - pad}
          y={-frame.h / 2 - pad}
          width={frame.w + pad * 2}
          height={frame.h + pad * 2}
          rx={4}
        />
        {HANDLES.filter((h) => !symbol || h.length === 2).map((h) => {
          const [sx, sy] = HANDLE_SIGN[h];
          return (
            <rect
              key={h}
              data-handle={h}
              className={`plan-editor__handle plan-editor__handle--${h}`}
              x={sx * (frame.w / 2 + pad) - 6}
              y={sy * (frame.h / 2 + pad) - 6}
              width={12}
              height={12}
              rx={2}
            />
          );
        })}
        {rotateGrip(0, -frame.h / 2 - pad)}
      </g>
    ) : (
      <g className="plan-editor__selection">
        <rect
          x={box.x - pad}
          y={box.y - pad}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          rx={4}
        />
        {ends?.map((p, i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: the two ends of a line.
            key={i}
            data-end={i}
            className="plan-editor__bend"
            cx={p.x}
            cy={p.y}
            r={8}
          />
        ))}
        {rotateGrip(box.x + box.w / 2, box.y - pad)}
      </g>
    ));
  const blockingGrips = isIcon(current) && (
    <g className="plan-editor__selection">
      {blockingPositions(current)
        .slice(1)
        .map((b, i) => {
          const a = blockingPositions(current)[i] as Point;
          const { middle } = blockingCurve(a, b, current.steps?.[i]?.bend);
          return (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: a move is its place in the order.
              key={i}
              data-bend={i}
              className="plan-editor__bend"
              cx={middle.x}
              cy={middle.y}
              r={9}
            />
          );
        })}
    </g>
  );
  const liveLayer = (
    <>
      {live && (
        <path
          d={pathOf(live, PLAN_VIEW_H)}
          fill="none"
          stroke="currentColor"
          strokeWidth={PLAN_PEN}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: planCss(ink) }}
        />
      )}
      {liveShape && (
        <PlanShapeView
          shape={
            {
              id: 'liveAAAA',
              kind: liveShape.kind,
              color: ink,
              width: PLAN_PEN,
              x0: toGrid(liveShape.a.x),
              y0: toGrid(liveShape.a.y),
              x1: toGrid(liveShape.b.x),
              y1: toGrid(liveShape.b.y),
            } as PlanShape
          }
        />
      )}
      {selection}
      {blockingGrips}
    </>
  );

  const title = planTitle(t, plan);
  const iconName = (i: PlanItem) =>
    isIcon(i)
      ? t(`board.plan.icons.${i.kind}`)
      : 'points' in i
        ? t('board.plan.tool.pencil')
        : t(`board.plan.shapes.${i.kind}`);

  const toolButton = (
    key: string,
    label: string,
    icon: ReactNode,
    on: boolean,
    act: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className="plan-editor__btn"
      aria-pressed={on}
      aria-label={label}
      data-ink-tooltip={label}
      onClick={act}
    >
      {icon}
    </button>
  );
  const tools = (
    <div className="plan-editor__tools" role="toolbar" aria-label={t('board.plan.tools')}>
      {TOOLS.filter((x) => !phone || x.phone).map((x) =>
        toolButton(
          x.tool,
          `${t(`board.plan.tool.${x.tool}`)} (${x.key})`,
          <Icon name={x.icon} size={16} />,
          tool === x.tool && !armed,
          () => {
            setArmed(null);
            setTool(x.tool);
          },
        ),
      )}
      <span className="plan-editor__sep" aria-hidden="true" />
      {toolButton(
        'icons',
        t('board.plan.tool.icons'),
        <Icon name="iconLibrary" size={16} />,
        tool === 'icons' || (phone && armed !== null),
        () => {
          setTool('icons');
          setPanel('icons');
        },
      )}
      {toolButton(
        'move',
        `${t('board.plan.tool.move')} (M)`,
        <Icon name="blocking" size={16} />,
        tool === 'move',
        () => {
          setArmed(null);
          setTool('move');
        },
      )}
      {!phone && (
        <>
          <span className="plan-editor__sep" aria-hidden="true" />
          {toolButton(
            'snap',
            `${t('board.plan.snap')} (G)`,
            <Icon name="grid" size={16} />,
            snap,
            () => setSnap((v) => !v),
          )}
        </>
      )}
    </div>
  );

  const swatches = current && (
    <>
      {PLAN_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          className="plan-editor__swatch"
          aria-pressed={current.color === c.hex}
          aria-label={t(`board.plan.colors.${c.name}`)}
          data-ink-tooltip={t(`board.plan.colors.${c.name}`)}
          onClick={() => recolor(c.hex)}
        >
          <i style={{ background: `var(--ink-${c.token})` }} />
        </button>
      ))}
    </>
  );
  const labelField = isIcon(current) && (
    <input
      className="plan-editor__field"
      aria-label={t('board.plan.labelField')}
      placeholder={t('board.plan.labelPlaceholder')}
      maxLength={60}
      value={current.label ?? ''}
      onFocus={() => store.undo.stopCapturing()}
      onBlur={() => store.undo.stopCapturing()}
      onChange={(e) => relabel(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
  /** Width and depth of furniture in metres; S, M, L of symbols and texts (round 6, e). */
  const sizeFields = current && (
    <>
      {isIcon(current) && categoryOf(current.kind).sized && plan.scale && frame && (
        <>
          <span className="plan-editor__vr" aria-hidden="true" />
          <NumberField
            value={Math.round((frame.w / plan.scale) * 100) / 100}
            min={0.05}
            max={100}
            step={0.01}
            label={t('board.plan.width')}
            onCommit={(m) => write({ ...current, w: m * (plan.scale as number), h: frame.h })}
          />
          <span className="plan-editor__times">×</span>
          <NumberField
            value={Math.round((frame.h / plan.scale) * 100) / 100}
            min={0.05}
            max={100}
            step={0.01}
            unit="m"
            label={t('board.plan.depth')}
            onCommit={(m) => write({ ...current, w: frame.w, h: m * (plan.scale as number) })}
          />
        </>
      )}
      {(symbol || ('x0' in current && current.kind === 'text')) && (
        <>
          <span className="plan-editor__vr" aria-hidden="true" />
          <fieldset className="plan-props__segmented" aria-label={t('board.plan.size')}>
            {(['S', 'M', 'L'] as const).map((size) => {
              const on = isIcon(current)
                ? (current.size ?? 'M') === size
                : 'x0' in current && current.width === TEXT_SIZES[size];
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (isIcon(current)) {
                      const next = { ...current, size: size as 'S' | 'L' };
                      if (size === 'M') delete (next as Partial<PlanIcon>).size;
                      write(next);
                    } else if ('x0' in current) write({ ...current, width: TEXT_SIZES[size] });
                  }}
                >
                  {size}
                </button>
              );
            })}
          </fieldset>
        </>
      )}
    </>
  );
  const bar = current && !(phone && tool === 'icons' && armed) && (
    <div
      className="plan-editor__bar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.selection')}
    >
      {swatches}
      {labelField && (
        <>
          <span className="plan-editor__vr" aria-hidden="true" />
          {labelField}
        </>
      )}
      {isIcon(current) && current.kind === 'camera' && (
        <button type="button" className="plan-editor__lens" onClick={() => setPanel('props')}>
          {current.lens ?? DEFAULT_LENS} mm
        </button>
      )}
      {sizeFields}
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="rotateRight"
        label={`${t('board.plan.rotate')} (R)`}
        onClick={() => rotate(ROTATE_STEP)}
      />
      {frame && (
        <NumberField
          value={shownAngle(current)}
          min={-360}
          max={360}
          unit="°"
          label={t('board.plan.angleField')}
          onCommit={(deg) => rotate(normalizeRotation(deg - shownAngle(current)))}
        />
      )}
      <IconButton icon="copy" label={t('board.plan.duplicate')} onClick={duplicate} />
      <IconButton icon="trash" label={t('board.plan.delete')} onClick={remove} />
    </div>
  );

  const library = (
    <PlanLibrary
      armed={armed}
      phone={phone}
      onArm={arm}
      onDrop={dropAt}
      onPlaceFirst={(next) => {
        arm(next);
        if (isIconKind(next)) placeIcon(next, { x: 0.5, y: 0.5 });
      }}
    />
  );

  const icon = isIcon(current) ? current : null;
  const cone = icon ? iconCone(icon, plan.sensor) : null;
  const camera = icon?.kind === 'camera' && cone && (
    <>
      <div className="plan-props__label">{t('board.plan.lens')}</div>
      <div className="plan-props__lenses">
        {LENSES.map((mm) => (
          <button
            key={mm}
            type="button"
            aria-pressed={(icon.lens ?? DEFAULT_LENS) === mm}
            onClick={() => write({ ...icon, lens: mm })}
          >
            {mm}
          </button>
        ))}
        <button
          type="button"
          className="plan-props__other"
          aria-pressed={otherLens || !LENSES.includes(icon.lens ?? DEFAULT_LENS)}
          onClick={() => setOtherLens(true)}
        >
          {t('board.plan.otherLens')}
        </button>
      </div>
      {(otherLens || !LENSES.includes(icon.lens ?? DEFAULT_LENS)) && (
        <div className="plan-props__row">
          <span>{t('board.plan.focal')}</span>
          <NumberField
            value={icon.lens ?? DEFAULT_LENS}
            min={4}
            max={2000}
            unit="mm"
            label={t('board.plan.focal')}
            onCommit={(mm) => write({ ...icon, lens: Math.round(mm) })}
          />
        </div>
      )}
      {lenses.length > 0 && (
        <div className="plan-props__hints">
          <span>{t('board.plan.fromFrames')}</span>
          {lenses.map((l) => (
            <button
              key={l.label}
              type="button"
              className="plan__badge"
              onClick={() => write({ ...icon, lens: l.mm })}
            >
              {l.label} · {l.mm} mm
            </button>
          ))}
        </div>
      )}
      <div className="plan-props__row">
        <span>{t('board.plan.sensor')}</span>
        <Select
          value={plan.sensor ?? 's35'}
          onChange={(v) =>
            change(() =>
              updateElement(
                doc,
                plan.id,
                { sensor: v === 's35' ? undefined : (v as PlanSensor) },
                LOCAL,
              ),
            )
          }
          options={(['s35', 'ff', 'm43', 's16'] as const).map((v) => ({
            value: v,
            label: t(`board.plan.sensors.${v}`),
          }))}
        />
      </div>
      <div className="plan-props__row">
        <span>{t('board.plan.angle')}</span>
        <b>{t('board.plan.angleValue', { angle: Math.round(cone.angle) })}</b>
      </div>
      <div className="plan-props__row">
        <span>{t('board.plan.reach')}</span>
        {plan.scale ? (
          <NumberField
            value={Math.round((cone.reach / plan.scale) * 10) / 10}
            min={0.5}
            max={100}
            step={0.5}
            unit="m"
            label={t('board.plan.reach')}
            onCommit={(m) => write({ ...icon, reach: (plan.scale as number) * m })}
          />
        ) : (
          <input
            type="range"
            className="plan-props__range"
            aria-label={t('board.plan.reach')}
            min={60}
            max={900}
            value={Math.round(cone.reach)}
            onPointerDown={() => store.undo.stopCapturing()}
            onChange={(e) =>
              updatePlanItems(doc, plan.id, [{ ...icon, reach: Number(e.target.value) }], LOCAL)
            }
          />
        )}
      </div>
      <label className="plan-props__row">
        <span>{t('board.plan.showLens')}</span>
        <Switch
          checked={!!icon.showLens}
          onChange={(e) => {
            const next = { ...icon, showLens: e.target.checked };
            if (!e.target.checked) delete (next as Partial<PlanIcon>).showLens;
            write(next);
          }}
        />
      </label>
    </>
  );
  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    shown: string,
    set: (v: number) => PlanIcon,
  ) => (
    <div className="plan-props__row">
      <span>{label}</span>
      <input
        type="range"
        className="plan-props__range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onPointerDown={() => store.undo.stopCapturing()}
        onPointerUp={() => store.undo.stopCapturing()}
        onChange={(e) => updatePlanItems(doc, plan.id, [set(Number(e.target.value))], LOCAL)}
      />
      <b className="plan-props__value">{shown}</b>
    </div>
  );
  const light = icon && cone?.beam && (
    <>
      <div className="plan-props__row">
        <span>{t('board.plan.power')}</span>
        <input
          className="plan-editor__field"
          aria-label={t('board.plan.power')}
          placeholder="1,2K"
          maxLength={20}
          value={icon.power ?? ''}
          onFocus={() => store.undo.stopCapturing()}
          onChange={(e) => {
            const next = { ...icon, power: e.target.value };
            if (!e.target.value) delete (next as Partial<PlanIcon>).power;
            updatePlanItems(doc, plan.id, [next], LOCAL);
          }}
        />
      </div>
      {range(t('board.plan.beam'), icon.beam ?? 30, 5, 180, `${icon.beam ?? 30}°`, (v) => ({
        ...icon,
        beam: v,
      }))}
      {range(
        t('board.plan.intensity'),
        Math.round((icon.intensity ?? 0.8) * 100),
        0,
        100,
        `${Math.round((icon.intensity ?? 0.8) * 100)}%`,
        (v) => ({ ...icon, intensity: v / 100 }),
      )}
    </>
  );

  const blocking = icon && (icon.steps?.length ?? 0) > 0 && (
    <>
      <div className="plan-props__label">
        {t('board.plan.positions', { count: (icon.steps?.length ?? 0) + 1 })}
      </div>
      <ol className="plan-props__steps">
        {[...(icon.steps ?? []), null].map((stepAt, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a position is its place in the order.
          <li key={i}>
            <span className="plan-props__num">{i + 1}</span>
            <input
              className="plan-editor__field"
              aria-label={t('board.plan.stepNote', { number: i + 1 })}
              placeholder={t('board.plan.stepPlaceholder')}
              maxLength={200}
              value={(stepAt ? stepAt.note : icon.note) ?? ''}
              onFocus={() => store.undo.stopCapturing()}
              onChange={(e) => {
                const note = e.target.value;
                const next: PlanIcon = { ...icon, steps: [...(icon.steps ?? [])] };
                if (stepAt) {
                  const edited: PlanStep = { ...stepAt, note };
                  if (!note) delete edited.note;
                  (next.steps as PlanStep[])[i] = edited;
                } else if (note) next.note = note;
                else delete next.note;
                updatePlanItems(doc, plan.id, [next], LOCAL);
              }}
            />
          </li>
        ))}
      </ol>
      <div className="plan-props__row">
        <span>{t('board.plan.line')}</span>
        <fieldset className="plan-props__segmented" aria-label={t('board.plan.line')}>
          {([false, true] as const).map((dashed) => (
            <button
              key={String(dashed)}
              type="button"
              aria-pressed={!!icon.dashed === dashed}
              onClick={() => {
                const next = { ...icon, dashed };
                if (!dashed) delete (next as Partial<PlanIcon>).dashed;
                write(next);
              }}
            >
              {t(dashed ? 'board.plan.dashed' : 'board.plan.solid')}
            </button>
          ))}
        </fieldset>
      </div>
      <label className="plan-props__row">
        <span>{t('board.plan.ghosts')}</span>
        <Switch checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} />
      </label>
    </>
  );
  /** The bar of the Movement tool, over the plan (round 6, d). */
  const moveBar = movingIcon && (
    <div
      className="plan-editor__movebar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.moveOf', {
        name: movingIcon.label || t(`board.plan.icons.${movingIcon.kind}`),
      })}
    >
      <span>
        {t('board.plan.moveOf', {
          name: movingIcon.label || t(`board.plan.icons.${movingIcon.kind}`),
        })}
      </span>
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="line"
        label={t('board.plan.solid')}
        aria-pressed={!movingIcon.dashed}
        onClick={() => {
          const next = { ...movingIcon };
          delete next.dashed;
          write(next);
        }}
      />
      <IconButton
        icon="dashed"
        label={t('board.plan.dashed')}
        aria-pressed={!!movingIcon.dashed}
        onClick={() => write({ ...movingIcon, dashed: true })}
      />
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="trash"
        label={t('board.plan.clearMoves')}
        onClick={() => {
          const next = { ...movingIcon };
          delete next.steps;
          delete next.note;
          delete next.dashed;
          write(next);
        }}
      />
    </div>
  );

  const properties = current ? (
    <div className="plan-props">
      <h3 className="plan-props__title">
        {icon && <PlanGlyph kind={icon.kind} size={18} />}
        {iconName(current)}
        {icon?.label && <span> · {icon.label}</span>}
      </h3>
      <div className="plan-props__row">
        <span>{t('board.plan.color')}</span>
        <span className="plan-props__swatches">{swatches}</span>
      </div>
      {labelField && (
        <div className="plan-props__row">
          <span>{t('board.plan.labelField')}</span>
          {labelField}
        </div>
      )}
      {camera}
      {blocking}
      {light}
      {icon && (
        <p className="plan-props__hint">
          {t(`board.plan.categories.${categoryOf(icon.kind).id}`)} ·{' '}
          {t(`board.plan.layers.${layerOf(icon)}`)}
        </p>
      )}
    </div>
  ) : (
    <p className="plan-props__empty">{t('board.plan.noSelection')}</p>
  );

  const stageArea = (
    <div className="plan-editor__stage-wrap">
      <div className="plan-editor__fit">
        <div
          ref={stage}
          className={`plan-editor__stage plan-editor__stage--${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <PlanDrawing plan={shown} grid={step} ghosts={ghosts}>
            {liveLayer}
          </PlanDrawing>
          {text && (
            <input
              ref={textInput}
              className="plan-editor__text"
              aria-label={t('film.pen.textField')}
              placeholder={t('film.pen.textPlaceholder')}
              maxLength={500}
              value={text.value}
              style={{ left: `${text.at.x * 100}%`, top: `${text.at.y * 100}%` }}
              onChange={(e) => {
                const draft = { ...text, value: e.target.value };
                textRef.current = draft;
                setText(draft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  textRef.current = null;
                  setText(null);
                }
              }}
              onBlur={commitText}
            />
          )}
        </div>
      </div>
      {moveBar}
      {phone && movingIcon && (
        <p className="plan-editor__hint">
          {t('board.plan.moveHint', { number: (movingIcon.steps?.length ?? 0) + 2 })}
        </p>
      )}
      {!phone && bar}
    </div>
  );

  if (phone)
    // On the body: over the phone's navigation bar, which the canvas does not cover.
    return createPortal(
      <div
        className="plan-editor plan-editor--phone"
        data-chrome=""
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="plan-editor__head">
          <IconButton icon="close" label={t('viewer.close')} onClick={onClose} />
          <b>{t('board.plan.name')}</b>
          <Button variant="primary" onClick={onClose}>
            {t('film.pen.done')}
          </Button>
        </header>
        {stageArea}
        {tool === 'icons' && !current && library}
        {bar}
        {tools}
      </div>,
      document.body,
    );
  // On the body too: the window sits in front of the whole app, the shell dimmed with the board.
  return createPortal(
    <div className="plan-editor" data-chrome="">
      <div className="plan-editor__backdrop" aria-hidden="true" onPointerDown={onClose} />
      <div className="plan-editor__window ink-motion-rise" role="dialog" aria-label={title}>
        <header className="plan-editor__head">
          <Icon name="map" size={15} />
          <span className="plan-editor__name">{t('board.plan.name')} ·</span>
          <input
            className="plan-editor__title"
            aria-label={t('board.plan.titleField')}
            placeholder={t('board.plan.titlePlaceholder')}
            maxLength={200}
            defaultValue={plan.title ?? ''}
            size={Math.max(8, (plan.title ?? '').length + 1)}
            onBlur={(e) =>
              change(() =>
                updateElement(doc, plan.id, { title: e.target.value.trim() || undefined }, LOCAL),
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <SceneBadges scenes={linked} onOpen={onOpenScene} />
          <IconButton
            icon="link"
            label={t('board.plan.linkScene')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicking({ x: r.left, y: r.bottom + 6 });
            }}
          />
          {picking && (
            <ScenePicker
              store={store}
              plan={plan}
              scenes={scenes}
              style={{ position: 'fixed', left: picking.x, top: picking.y }}
              onClose={() => setPicking(null)}
            />
          )}
          <span className="plan-editor__spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('film.pen.done')}
          </Button>
        </header>
        <div className="plan-editor__body">
          {tools}
          {stageArea}
          <aside className="plan-editor__panel">
            <div className="plan-editor__tabs" role="tablist">
              {(['icons', 'props'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={panel === p}
                  onClick={() => setPanel(p)}
                >
                  {t(`board.plan.panel.${p}`)}
                </button>
              ))}
            </div>
            {panel === 'icons' ? library : properties}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const TOOL_OF_NOTE: Record<PlanNoteTool, Tool> = {
  arrow: 'arrow',
  text: 'text',
  measure: 'measure',
  zone: 'zone',
};
