// SPDX-License-Identifier: AGPL-3.0-only
import {
  addBlockingStep,
  addShape,
  addStroke,
  attachedPlacement,
  attachIcon,
  attachRole,
  bendThrough,
  blockingCurve,
  blockingPositions,
  coneEnd,
  detachIcon,
  encodeStroke,
  gridLength,
  iconCentre,
  iconCone,
  isSized,
  itemBox,
  itemFrame,
  itemsBox,
  itemsInRect,
  moveItem,
  moveWithAttached,
  normalizeRotation,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanItem,
  type PlanItemRef,
  type Point,
  planItem,
  planItemAt,
  planItems,
  pulledAway,
  type ResizeHandle,
  ROTATE_STEP,
  resizeItem,
  rotateItem,
  rotateManyWithAttached,
  rotateWithAttached,
  scaleFor,
  settleAttached,
  shownAngle,
  snapPlanPoint,
  toGrid,
  updateElement,
  withAttached,
  withGroups,
  withReachAt,
} from '@inkadra/canvas-core';
import {
  type FrameShape,
  MAX_SHAPES,
  MAX_STROKES,
  PLAN_ASPECT,
  PLAN_LAYERS,
  type PlanIcon,
  type PlanShape,
  type PlanStep,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName, Switch } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import {
  type CSSProperties,
  type PointerEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, type MenuItem } from '../chrome.tsx';
import { pathOf } from '../film/strokes.ts';
import { LOCAL } from '../store.ts';
import { type DragKind, type Ed, isIcon, MAX_SCALE, QUARTER_TURN, type Tool } from './editing.ts';
import { measureValue } from './kit.ts';
import { isNoteTool } from './library.ts';
import { useBackgroundPlacing } from './PlanBackground.tsx';
import {
  NOTE_COLOR,
  PLAN_INK,
  PLAN_PEN,
  PLAN_TEXT,
  PlanDrawing,
  PlanShapeView,
  planCss,
  TEXT_SIZES,
} from './PlanDrawing.tsx';
import { useWallTools } from './PlanWalls.tsx';

/** Two presses on an item within this time (ms) are a double click, by mouse or by finger. */
const DOUBLE_PRESS = 400;
/** A finger held this long (ms) on the empty plan starts a selection box. */
const LONG_PRESS = 400;
/** A finger that moves less than this (view units, about 9 px on a phone) has tapped. */
const TAP_SLOP = 24;
/** Steps of the zoom, in percent of the plan fitted to its area. */
export const ZOOMS = [50, 75, 100, 150, 200, 300, 400];
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
/** The tools of the bar at the bottom, with their keys (decisions 0104 and 0110). */
export const TOOL_KEYS: Array<{ tool: Tool; key: string }> = [
  { tool: 'select', key: 'V' },
  { tool: 'walls', key: 'W' },
  { tool: 'openings', key: 'D' },
  { tool: 'pencil', key: 'P' },
  { tool: 'line', key: 'L' },
  { tool: 'arrow', key: 'A' },
  { tool: 'rect', key: 'Q' },
  { tool: 'ellipse', key: 'O' },
  { tool: 'text', key: 'T' },
  { tool: 'measure', key: 'U' },
];

interface TextDraft {
  at: Point;
  value: string;
  color: string;
}
type Gesture =
  | {
      kind: 'move';
      ref: PlanItemRef;
      start: Point;
      item: PlanItem;
      /** Snapping (decision 0104): the base it lands on, and whether it was pulled off its own. */
      target?: string | null;
      pulled?: boolean;
    }
  | { kind: 'rotate'; ref: PlanItemRef; centre: Point; from: number; item: PlanItem }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'shape'; shape: DragKind; a: Point; b: Point; raw: [Point, Point] }
  | { kind: 'bend'; index: number; item: PlanIcon }
  | { kind: 'reach'; item: PlanIcon }
  | { kind: 'resize'; handle: ResizeHandle; item: PlanItem }
  | { kind: 'moveMany'; start: Point; items: PlanItem[] }
  | { kind: 'rotateMany'; centre: Point; from: number; items: PlanItem[] }
  | { kind: 'marquee'; a: Point; add: boolean; touch: boolean; at: number; live: boolean }
  | { kind: 'end'; which: 0 | 1; item: PlanShape };

/** View units of a point of the drawing (0 to 1). */
const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });

/** What the shell asks of the canvas: Escape, the scale tool, a measure to write, a drop. */
export interface CanvasHandle {
  /** Closes what the canvas has open; false when nothing was. */
  escape: () => boolean;
  openMeasure: (id: string) => void;
  /** A client point as a point of the drawing (0 to 1), or null outside it. */
  pointOf: (at: { clientX: number; clientY: number }) => Point | null;
  zoomBy: (dir: 1 | -1) => void;
  /** A key for the tool in use (the length typed for a wall); true when it took it. */
  key: (e: KeyboardEvent) => boolean;
}

/** The menu of the selection: on a right click, and behind "…" in the properties. */
export function selectionMenu(ed: Ed, t: TFunction): MenuItem[] {
  const items = ed.many.length > 1 ? ed.many : ed.item ? [ed.item] : [];
  if (!items.length) return [];
  const icons = items.some(isIcon);
  const ownLayer = items.every((i) => ed.ownerOf(i.id) === ed.plan.id);
  const layerOfAll = items.every((i) => (i.layer ?? null) === (items[0]?.layer ?? null));
  return [
    { label: t('board.plan.duplicate'), icon: 'copy', shortcut: 'Ctrl+D', action: ed.duplicate },
    {
      label: t('board.plan.forward'),
      icon: 'front',
      shortcut: ']',
      disabled: !icons,
      action: () => ed.restack(1),
    },
    {
      label: t('board.plan.backward'),
      icon: 'arrange',
      shortcut: '[',
      disabled: !icons,
      action: () => ed.restack(-1),
    },
    {
      label: t('board.plan.rotateBy', { degrees: QUARTER_TURN }),
      icon: 'rotateRight',
      shortcut: 'R',
      action: () => ed.rotate(QUARTER_TURN),
    },
    ...(ownLayer
      ? ([
          { heading: t('board.plan.moveToLayer') },
          ...PLAN_LAYERS.filter((l) => !(ed.base && l === 'set')).map((l) => ({
            label: t(`board.plan.layers.${l}`),
            checked: layerOfAll && items.every((i) => (i.layer ?? null) === l),
            action: () => ed.moveToLayer(l),
          })),
        ] as MenuItem[])
      : []),
    { divider: true },
    {
      label: t('board.plan.delete'),
      icon: 'trash',
      danger: true,
      shortcut: 'Del',
      action: () => ed.remove(),
    },
  ];
}

/**
 * The drawing of the editor (decision 0104): the plan fitted to its area and zoomable, the
 * gestures of decision 0071 (draw, place, move, turn, resize, box selection, blocking), the bar
 * of tools at the bottom, the zoom and, with a scale, the scale bar. Nothing floats over the
 * drawing for the selection: its properties are in the right panel.
 */
export function PlanCanvas({ ed, handle }: { ed: Ed; handle: RefObject<CanvasHandle | null> }) {
  const { t, i18n } = useTranslation();
  const { phone, drawn, step, tool, armed } = ed;
  const [shapeTool, setShapeTool] = useState<'rect' | 'ellipse'>('rect');
  const [lineTool, setLineTool] = useState<'line' | 'arrow'>('line');
  const [zoom, setZoom] = useState(100);
  const [px, setPx] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [measureDraft, setMeasureDraft] = useState<{
    id: string;
    value: string;
    wrong: boolean;
    asking: string | null;
    at: Point;
  } | null>(null);
  const [scaleDraft, setScaleDraft] = useState<{ length: number; metres: string } | null>(null);
  const [gridDraft, setGridDraft] = useState<'0.25' | '0.5' | '1'>(drawn.grid ?? '0.5');
  const [rulersDraft, setRulersDraft] = useState(drawn.rulers ?? true);
  const [chip, setChip] = useState<string | null>(null);
  /** The base a dragged icon would attach to, lit while dragging (decision 0104). */
  const [target, setTarget] = useState<PlanIcon | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [live, setLiveState] = useState<{ points: Point[]; n: number } | null>(null);
  const setLive = (points: Point[] | null) =>
    setLiveState(points ? { points, n: points.length } : null);
  const [liveShape, setLiveShape] = useState<{ kind: DragKind; a: Point; b: Point } | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPress = useRef<{ id: string; at: number } | null>(null);
  const tapOff = useRef<PlanItemRef[] | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const viewOf = ed.viewOf;
  const ink =
    ed.penColor ?? ((armed && isNoteTool(armed)) || tool === 'measure' ? NOTE_COLOR : PLAN_INK);
  const onLayer = ed.activeLayer ? { layer: ed.activeLayer } : {};
  const selection = ed.selection;
  const selected = selection.length === 1 ? (selection[0] as PlanItemRef) : null;
  const item = ed.item;
  const shown = ed.shown;
  const current = ed.preview?.find((p) => p.id === item?.id) ?? item ?? null;
  const many = selection.length > 1 ? selection.flatMap((r) => planItem(shown, r) ?? []) : [];

  useEffect(() => {
    if (text) textInput.current?.focus();
  }, [text]);
  // The size of a view unit on screen, for the scale bar.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const snapped = (p: Point) => (ed.snap ? snapPlanPoint(p, step) : p);
  const walls = useWallTools(ed, { snapped, zoom });
  const placing = useBackgroundPlacing(ed, zoom);
  const zoomBy = (dir: 1 | -1) =>
    setZoom((z) => {
      const at = ZOOMS.indexOf(z);
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + dir))] as number;
    });
  // The middle of what is in view, where Enter and a tap on the phone place.
  ed.middle.current = () => {
    const s = scroller.current?.getBoundingClientRect();
    if (!s) return { x: 0.5, y: 0.5 };
    const p = pointAt({ clientX: s.left + s.width / 2, clientY: s.top + s.height / 2 });
    return { x: Math.max(0.02, Math.min(0.98, p.x)), y: Math.max(0.02, Math.min(0.98, p.y)) };
  };

  function openMeasure(m: {
    id: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    length?: number;
    text?: string | undefined;
  }) {
    const written = m.text ? Number(m.text) : 0;
    const length = m.length ?? gridLength(m.x0, m.y0, m.x1, m.y1);
    const metres = written > 0 ? written : drawn.scale ? length / drawn.scale : 0;
    setMeasureDraft({
      id: m.id,
      value: metres
        ? metres.toLocaleString(i18n.language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '',
      wrong: false,
      asking: null,
      at: { x: (m.x0 + m.x1) / 8192, y: Math.max(m.y0, m.y1) / 4096 },
    });
  }
  useImperativeHandle(handle, () => ({
    escape: () => {
      if (walls.escape()) return true;
      // Placing the background ends before anything else, even with its picture gone.
      if (ed.placingBackground) ed.setPlacingBackground(false);
      else if (menu) setMenu(null);
      else if (scaleDraft) setScaleDraft(null);
      else if (measureDraft) setMeasureDraft(null);
      else return false;
      return true;
    },
    openMeasure: (id) => {
      const found = planItem(drawn, { kind: 'shapes', id });
      if (found && 'x0' in found) openMeasure(found);
    },
    pointOf: (at) => {
      const p = pointAt(at);
      return inside(p) ? p : null;
    },
    zoomBy,
    key: (e) => walls.key(e),
  }));

  const commitText = () => {
    const draft = textRef.current;
    textRef.current = null;
    setText(null);
    if (draft) ed.disarm();
    const value = draft?.value.trim().slice(0, 500);
    if (!draft || !value) return;
    const x = toGrid(draft.at.x);
    const y = toGrid(draft.at.y);
    // A text is a note unless a layer is active: it goes where that layer lives.
    ed.change(() =>
      addShape(
        ed.doc,
        ed.targetFor(ed.activeLayer ?? 'notes'),
        {
          ...onLayer,
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

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.plan-editor__text')) return;
    e.stopPropagation();
    setMenu(null);
    const p = pointAt(e);
    if (text) {
      commitText();
      return;
    }
    // Placing the background takes every press until Done (decision 0110).
    if (placing.down(p, e.target as Element)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      ed.store.undo.stopCapturing();
      return;
    }
    if (walls.down(p)) return;
    // A double click writes: the words of a text in its field, the number of a measure.
    if (tool === 'select' && !armed) {
      const pressed = planItemAt(drawn, p, viewOf);
      const previous = lastPress.current;
      lastPress.current = pressed ? { id: pressed.id, at: e.timeStamp } : null;
      if (pressed && previous?.id === pressed.id && e.timeStamp - previous.at < DOUBLE_PRESS) {
        const target = planItem(drawn, pressed);
        if (target && 'x0' in target && target.kind === 'text') {
          ed.select(pressed);
          ed.setTab('properties');
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>('[data-plan-field="text"]')?.focus(),
          );
          return;
        }
        if (target && 'x0' in target && target.kind === 'measure') {
          ed.select(pressed);
          openMeasure(target);
          return;
        }
      }
    }
    const grip = (e.target as Element).closest<SVGElement>('[data-handle]');
    if (grip && item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      ed.store.undo.stopCapturing();
      gesture.current = { kind: 'resize', handle: grip.dataset.handle as ResizeHandle, item };
      return;
    }
    const end = (e.target as Element).closest<SVGElement>('[data-end]');
    if (end && item && 'x0' in item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'end', which: end.dataset.end === '1' ? 1 : 0, item };
      return;
    }
    const reachGrip = (e.target as Element).closest<SVGElement>('[data-reach]');
    if (reachGrip && isIcon(item)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'reach', item };
      return;
    }
    const bend = (e.target as Element).closest<SVGElement>('[data-bend]');
    if (bend && isIcon(item)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'bend', index: Number(bend.dataset.bend), item };
      return;
    }
    if (tool === 'move') {
      if (ed.movingIcon) ed.write(addBlockingStep(ed.movingIcon, snapped(p)));
      return;
    }
    ed.setLockedItem(null);
    if (armed && !isNoteTool(armed)) {
      const on = ed.attach && !e.altKey ? ed.snapAt({ kind: armed }, view(p)) : null;
      ed.placeIcon(armed, snapped(p), { keep: e.shiftKey, on: on?.id ?? null });
      return;
    }
    const rotateHandle = (e.target as Element).closest('[data-rotate]');
    if (rotateHandle && many.length > 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const b = itemsBox(many);
      const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const q = view(p);
      gesture.current = {
        kind: 'rotateMany',
        centre,
        from: Math.atan2(q.y - centre.y, q.x - centre.x),
        items: many,
      };
      return;
    }
    if (rotateHandle && item && selected) {
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
    // The corners of a picked wall are on top of what is under them.
    const corner = (e.target as Element).closest('[data-corner]');
    if (tool === 'select' && corner && walls.pick(p, e.target as Element)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'select' || tool === 'icons') {
      const hit = planItemAt(drawn, p, viewOf);
      if (hit && (e.shiftKey || (phone && tool === 'select' && selection.length > 0))) {
        // Shift (or, on a phone, a tap while something is picked) adds or takes away.
        const group = withGroups(drawn, [hit]);
        const has = selection.some((r) => r.id === hit.id);
        if (e.shiftKey || !has) {
          ed.setSelection(
            has
              ? selection.filter((r) => !group.some((g) => g.id === r.id))
              : [...selection, ...group.filter((g) => !selection.some((r) => r.id === g.id))],
          );
          return;
        }
        tapOff.current = group;
      }
      const picked = hit
        ? selection.some((r) => r.id === hit.id)
          ? selection
          : withGroups(drawn, [hit])
        : [];
      if (hit && picked.length > 1) {
        ed.setSelection(picked);
        e.currentTarget.setPointerCapture(e.pointerId);
        ed.store.undo.stopCapturing();
        gesture.current = {
          kind: 'moveMany',
          start: p,
          items: picked.flatMap((r) => planItem(drawn, r) ?? []),
        };
        return;
      }
      if (hit) {
        const target = planItem(drawn, hit);
        ed.select(hit);
        if (!target) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        ed.store.undo.stopCapturing();
        gesture.current = { kind: 'move', ref: hit, start: p, item: target };
        return;
      }
      // Walls and openings, under the items (decision 0110).
      if (tool === 'select' && !e.shiftKey && walls.pick(p, e.target as Element)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (ed.wallSel || ed.lockedWall) ed.selectWall(null);
      // An item of a locked layer cannot be picked, but says why in the properties.
      const under = planItemAt(drawn, p, { hidden: ed.hiddenLayers });
      const lockedOne = under && planItem(drawn, under);
      if (lockedOne) ed.setLockedItem(lockedOne);
      if (!e.shiftKey) ed.setSelection([]);
      e.currentTarget.setPointerCapture(e.pointerId);
      // A finger draws the box after a long press; a mouse at once.
      const touch = e.pointerType === 'touch';
      const started = {
        kind: 'marquee' as const,
        a: p,
        add: e.shiftKey,
        touch,
        at: e.timeStamp,
        live: !touch,
      };
      gesture.current = started;
      if (touch)
        longPress.current = setTimeout(() => {
          if (gesture.current !== started) return;
          started.live = true;
          setMarquee({ a: p, b: p });
        }, LONG_PRESS);
      else setMarquee({ a: p, b: p });
      return;
    }
    ed.select(null);
    if (tool === 'text') {
      if ((ed.plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
      e.preventDefault();
      const draft = { at: p, value: '', color: ink };
      textRef.current = draft;
      setText(draft);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pencil') {
      if ((ed.plan.strokes?.length ?? 0) >= MAX_STROKES) return;
      gesture.current = { kind: 'draw', points: [p] };
      setLive([p]);
      return;
    }
    if ((ed.plan.shapes?.length ?? 0) >= MAX_SHAPES || tool === 'walls' || tool === 'openings')
      return;
    const a = snapped(p);
    gesture.current = { kind: 'shape', shape: tool, a, b: a, raw: [p, p] };
    setLiveShape({ kind: tool, a, b: a });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const p = pointAt(e);
    if (placing.move(p) || walls.move(p)) return;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'marquee') {
      if (!g.live) {
        const moved = Math.hypot(view(p).x - view(g.a).x, view(p).y - view(g.a).y) > 12;
        if (e.timeStamp - g.at >= LONG_PRESS) g.live = true;
        else if (moved) {
          gesture.current = null;
          clearTimeout(longPress.current);
        }
        if (!g.live) return;
      }
      setMarquee({ a: g.a, b: p });
      return;
    }
    if (tapOff.current && (g.kind === 'move' || g.kind === 'moveMany')) {
      const moved = Math.hypot(view(p).x - view(g.start).x, view(p).y - view(g.start).y);
      if (moved < TAP_SLOP) return;
      tapOff.current = null;
    }
    if (g.kind === 'moveMany') {
      let d = { x: view(p).x - view(g.start).x, y: view(p).y - view(g.start).y };
      if (ed.snap) {
        const b = itemsBox(g.items);
        const to = snapPlanPoint(
          { x: (b.x + d.x) / PLAN_VIEW_W, y: (b.y + d.y) / PLAN_VIEW_H },
          step,
        );
        d = { x: view(to).x - b.x, y: view(to).y - b.y };
      }
      // Icons take what is attached to them along.
      const carried = moveWithAttached(
        ed.icons,
        g.items.filter(isIcon).map((i) => i.id),
        d,
      );
      ed.setPreview([...g.items.filter((i) => !isIcon(i)).map((i) => moveItem(i, d)), ...carried]);
      return;
    }
    if (g.kind === 'rotateMany') {
      const q = view(p);
      let degrees = ((Math.atan2(q.y - g.centre.y, q.x - g.centre.x) - g.from) * 180) / Math.PI;
      if (ed.snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      // What is attached to them turns with them (decision 0104).
      ed.setPreview(
        rotateManyWithAttached(ed.icons, g.items, normalizeRotation(degrees), g.centre),
      );
      const shownDeg = normalizeRotation(degrees);
      setChip(`${shownDeg > 180 ? shownDeg - 360 : shownDeg}°`);
      return;
    }
    if (g.kind === 'move') {
      let d = { x: view(p).x - view(g.start).x, y: view(p).y - view(g.start).y };
      if (ed.snap && isIcon(g.item)) {
        // An icon's centre lands on the grid.
        const c = { x: (g.item.x / 4096) * PLAN_VIEW_W, y: (g.item.y / 4096) * PLAN_VIEW_H };
        const to = snapPlanPoint(
          { x: (c.x + d.x) / PLAN_VIEW_W, y: (c.y + d.y) / PLAN_VIEW_H },
          step,
        );
        d = { x: view(to).x - c.x, y: view(to).y - c.y };
      }
      if (!isIcon(g.item)) {
        ed.setPreview(moveItem(g.item, d));
        return;
      }
      const icons = ed.icons;
      const moved = moveItem(g.item, d);
      const at = iconCentre(moved);
      const base = g.item.on ? icons.find((i) => i.id === (g.item as PlanIcon).on) : undefined;
      if (base && !pulledAway(g.item, at, icons)) {
        // Still on its base: a dolly slides along its track, a person takes the nearest seat.
        const place = attachedPlacement(moved, base, icons);
        const sits = place ? { ...moved, ...place } : g.item;
        const rest = icons.map((i) => (i.id === sits.id ? sits : i));
        g.pulled = false;
        g.target = null;
        setTarget(null);
        ed.setPreview([sits, ...settleAttached(rest, sits.id)]);
        return;
      }
      // Free, or pulled off its base: it may land on another, unless Alt or Snap off says free.
      g.pulled = !!base;
      const free = !ed.attach || e.altKey || !attachRole(g.item.kind);
      const target = free ? null : ed.snapAt(g.item, at);
      g.target = target?.id ?? null;
      setTarget(target);
      // What is on it moves with it.
      const group = moveWithAttached(icons, [g.item.id], d);
      ed.setPreview(group.length ? group.map((i) => (i.id === moved.id ? moved : i)) : moved);
    } else if (g.kind === 'resize') {
      const symbol = isIcon(g.item) && !isSized(g.item.kind);
      ed.setPreview(
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
      ed.setPreview(next);
    } else if (g.kind === 'reach') {
      ed.setPreview(withReachAt(g.item, view(p), ed.plan.sensor));
    } else if (g.kind === 'bend') {
      const at = blockingPositions(g.item);
      const a = at[g.index] as Point;
      const b = at[g.index + 1] as Point;
      const steps = [...(g.item.steps ?? [])];
      steps[g.index] = {
        ...(steps[g.index] as PlanStep),
        bend: Math.round(bendThrough(a, b, view(p))),
      };
      ed.setPreview({ ...g.item, steps });
    } else if (g.kind === 'rotate') {
      const q = view(p);
      const angle = Math.atan2(q.y - g.centre.y, q.x - g.centre.x);
      let degrees = ((angle - g.from) * 180) / Math.PI;
      if (ed.snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      const turned = rotateItem(g.item, normalizeRotation(degrees));
      // A base turns what is on it as one piece.
      const carried =
        isIcon(g.item) && withAttached(ed.icons, [g.item.id]).size > 1
          ? rotateWithAttached(ed.icons, g.item.id, normalizeRotation(degrees))
          : [];
      ed.setPreview(carried.length ? carried : turned);
      setChip(`${shownAngle(turned)}°`);
    } else if (g.kind === 'draw') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length > 0 ? events : [e.nativeEvent]) g.points.push(pointAt(ev));
      setLive(g.points);
    } else {
      g.b = snapped(p);
      g.raw[1] = p;
      setLiveShape({ kind: g.shape, a: g.a, b: g.b });
    }
  }

  /** A gesture the browser took away (a scroll, a second finger): nothing is written. */
  function onPointerCancel() {
    walls.cancel();
    clearTimeout(longPress.current);
    tapOff.current = null;
    gesture.current = null;
    ed.setPreview(null);
    setChip(null);
    setLive(null);
    setLiveShape(null);
    setMarquee(null);
  }

  function onPointerUp() {
    if (placing.up() || walls.up()) return;
    clearTimeout(longPress.current);
    const taken = tapOff.current;
    tapOff.current = null;
    if (taken) ed.setSelection((now) => now.filter((r) => !taken.some((x) => x.id === r.id)));
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (!m) return;
      const a = view(m.a);
      const b = view(m.b);
      const rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      };
      if (rect.w + rect.h < 4) return;
      ed.setLockedItem(null);
      const hits = withGroups(drawn, itemsInRect(drawn, rect, viewOf));
      ed.setSelection(
        g.add ? [...selection, ...hits.filter((h) => !selection.some((r) => r.id === h.id))] : hits,
      );
      return;
    }
    if (g.kind !== 'draw' && g.kind !== 'shape') {
      setChip(null);
      const next = ed.previewRef.current;
      ed.setPreview(null);
      setTarget(null);
      if (!next) return;
      ed.write(withSnapping(g, next), 'items' in g ? g.items : [g.item]);
      return;
    }
    if (g.kind === 'draw') {
      setLive(null);
      ed.change(() =>
        addStroke(
          ed.doc,
          ed.targetFor(ed.activeLayer ?? 'set'),
          {
            ...onLayer,
            tool: 'pencil',
            color: ink,
            width: PLAN_PEN,
            points: encodeStroke(g.points),
          },
          LOCAL,
        ),
      );
      return;
    }
    setLiveShape(null);
    if (g.shape === 'scale') {
      const length = gridLength(toGrid(g.a.x), toGrid(g.a.y), toGrid(g.b.x), toGrid(g.b.y));
      ed.setTool('select');
      if (length > 10) setScaleDraft({ length, metres: '' });
      return;
    }
    // A measure's ends that start or land on an icon stay on it.
    const endOn = (q: Point) => {
      if (g.shape !== 'measure') return null;
      const hit = planItemAt(drawn, q, viewOf);
      const target = hit && planItem(drawn, hit);
      return isIcon(target) ? target : null;
    };
    const fromIcon = endOn(g.raw[0]);
    const toIcon = endOn(g.raw[1]);
    if (fromIcon) g.a = { x: fromIcon.x / 4096, y: fromIcon.y / 4096 };
    if (toIcon) g.b = { x: toIcon.x / 4096, y: toIcon.y / 4096 };
    const shape = {
      kind: g.shape,
      color: ink,
      width: PLAN_PEN,
      x0: toGrid(g.a.x),
      y0: toGrid(g.a.y),
      x1: toGrid(g.b.x),
      y1: toGrid(g.b.y),
      ...(g.shape === 'zone' || g.shape === 'measure' ? { layer: 'notes' as const } : {}),
      ...(fromIcon ? { from: fromIcon.id } : {}),
      ...(toIcon ? { to: toIcon.id } : {}),
    };
    if (Math.abs(shape.x1 - shape.x0) + Math.abs(shape.y1 - shape.y0) < 8) return;
    let created: string | null = null;
    ed.change(() => {
      created = addShape(
        ed.doc,
        ed.targetFor(shape.layer ?? ed.activeLayer ?? 'set'),
        { ...(shape.layer ? {} : onLayer), ...shape } as unknown as FrameShape,
        LOCAL,
      );
    });
    if (armed) ed.setArmed(null);
    if (armed && g.shape !== 'measure') ed.setTool('select');
    if (created && g.shape === 'measure') {
      const length = gridLength(shape.x0, shape.y0, shape.x1, shape.y1);
      openMeasure({ id: created, x0: shape.x0, y0: shape.y0, x1: shape.x1, y1: shape.y1, length });
    }
  }

  const writeMeasure = (id: string, value: string | undefined) => {
    const found = planItem(drawn, { kind: 'shapes', id });
    if (!found) return;
    const next = { ...found, text: value } as PlanShape;
    if (value === undefined) delete next.text;
    ed.write(next);
  };
  const commitMeasure = () => {
    if (!measureDraft) return;
    const value = measureValue(measureDraft.value);
    if (!value) {
      setMeasureDraft({ ...measureDraft, wrong: true });
      return;
    }
    if (drawn.scale) {
      writeMeasure(measureDraft.id, value);
      setMeasureDraft(null);
    } else setMeasureDraft({ ...measureDraft, wrong: false, asking: value });
  };
  const measureAsScale = () => {
    const found = measureDraft && planItem(drawn, { kind: 'shapes', id: measureDraft.id });
    if (!measureDraft?.asking || !found || !('x0' in found)) return;
    const next = scaleFor(
      gridLength(found.x0, found.y0, found.x1, found.y1),
      Number(measureDraft.asking),
    );
    if (next && next <= MAX_SCALE)
      ed.editPlan(
        { scale: Math.round(next * 100) / 100, grid: drawn.grid ?? '0.5', rulers: true },
        ed.scaleOwner,
      );
    setMeasureDraft(null);
  };

  // Selection handles ------------------------------------------------------------------
  const box = current ? itemBox(current) : null;
  const frame = current ? itemFrame(current) : null;
  const pad = 8;
  const symbol = isIcon(current) && !isSized(current.kind);
  const ends =
    current && 'x0' in current && !frame
      ? [
          { x: current.x0 * (PLAN_VIEW_W / 4096), y: current.y0 * (PLAN_VIEW_H / 4096) },
          { x: current.x1 * (PLAN_VIEW_W / 4096), y: current.y1 * (PLAN_VIEW_H / 4096) },
        ]
      : null;
  const k = zoom / 100;
  const grip = (phone ? 28 : 12) / k;
  const rotateGrip = (x: number, y: number) => (
    <g data-rotate="" className="plan-editor__rotate">
      <line x1={x} y1={y} x2={x} y2={y - 32 / k} />
      <circle cx={x} cy={y - 40 / k} r={(phone ? 18 : 8) / k} />
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
  const outline =
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
              x={sx * (frame.w / 2 + pad) - grip / 2}
              y={sy * (frame.h / 2 + pad) - grip / 2}
              width={grip}
              height={grip}
              rx={symbol ? grip / 2 : 2}
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
  const groupBox = many.length > 1 ? itemsBox(many) : null;
  const manyBox = groupBox && (
    <g className="plan-editor__selection">
      {many.map((i) => {
        const b = itemBox(i);
        return (
          <rect
            key={i.id}
            className="plan-editor__member"
            x={b.x - 3}
            y={b.y - 3}
            width={b.w + 6}
            height={b.h + 6}
            rx={3}
          />
        );
      })}
      <rect
        x={groupBox.x - pad}
        y={groupBox.y - pad}
        width={groupBox.w + pad * 2}
        height={groupBox.h + pad * 2}
        rx={4}
      />
      {rotateGrip(groupBox.x + groupBox.w / 2, groupBox.y - pad)}
    </g>
  );
  const moving = ed.moving;
  const litIcon = target ?? ed.icons.find((i) => i.id === ed.dropTarget) ?? null;
  const lit = litIcon ? itemBox(litIcon) : null;
  /**
   * What a gesture writes, with the snapping of decision 0104: an icon pulled off its base is
   * detached, one let go on a base is attached. What sits on a resized base settles in
   * ed.writeItems, as for every write.
   */
  const withSnapping = (g: Gesture, next: PlanItem[]): PlanItem[] => {
    if (!('item' in g) || !isIcon(g.item)) return next;
    const id = g.item.id;
    const merge = (list: readonly PlanIcon[], by: readonly PlanItem[]) =>
      list.map((i) => (by.find((n) => n.id === i.id) as PlanIcon | undefined) ?? i);
    const out = new Map(next.map((i) => [i.id, i]));
    let icons = merge(ed.icons, next);
    const take = (changed: readonly PlanIcon[]) => {
      for (const i of changed) out.set(i.id, i);
      icons = merge(icons, changed);
    };
    if (g.kind === 'move' && g.pulled) take(detachIcon(icons, id));
    if (g.kind === 'move' && g.target) take(attachIcon(icons, id, g.target));
    return [...out.values()];
  };
  const reachEnd = isIcon(current) && !moving ? coneEnd(current, ed.plan.sensor) : null;
  const reachGrip = reachEnd && (
    <circle
      data-reach=""
      className="plan-editor__reach"
      cx={reachEnd.x}
      cy={reachEnd.y}
      r={(phone ? 20 : 8) / k}
      role="slider"
      tabIndex={0}
      aria-label={t('board.plan.reach')}
      aria-valuemin={20}
      aria-valuemax={4000}
      aria-valuenow={Math.round(iconCone(current as PlanIcon, ed.plan.sensor)?.reach ?? 0)}
    />
  );
  const blockingGrips = isIcon(current) && !moving && (
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
      {placing.overlay}
      {walls.overlay}
      {live && (
        <path
          d={pathOf(live.points, PLAN_VIEW_H)}
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
              kind: liveShape.kind === 'scale' ? 'measure' : liveShape.kind,
              ...(liveShape.kind === 'scale' ? { dashed: true } : {}),
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
      {lit && (
        <rect
          className="plan-editor__target"
          x={lit.x - 6}
          y={lit.y - 6}
          width={lit.w + 12}
          height={lit.h + 12}
          rx={6}
        />
      )}
      {many.length > 1 ? manyBox : !moving && outline}
      {blockingGrips}
      {reachGrip}
      {marquee && (
        <rect
          className="plan-editor__marquee"
          x={Math.min(marquee.a.x, marquee.b.x) * PLAN_VIEW_W}
          y={Math.min(marquee.a.y, marquee.b.y) * PLAN_VIEW_H}
          width={Math.abs(marquee.b.x - marquee.a.x) * PLAN_VIEW_W}
          height={Math.abs(marquee.b.y - marquee.a.y) * PLAN_VIEW_H}
        />
      )}
    </>
  );

  // The bars ---------------------------------------------------------------------------
  const pickTool = (next: Tool) => {
    ed.setArmed(null);
    ed.setTool(next);
    if (next === 'rect' || next === 'ellipse') setShapeTool(next);
    if (next === 'line' || next === 'arrow') setLineTool(next);
  };
  const toolButton = (
    key: string,
    label: string,
    icon: IconName,
    on: boolean,
    act: () => void,
    opts: { disabled?: boolean; text?: string; shortcut?: string } = {},
  ) => (
    <button
      key={key}
      type="button"
      className="plan-tool"
      aria-pressed={on}
      aria-label={opts.shortcut ? `${label} (${opts.shortcut})` : label}
      data-ink-tooltip={opts.shortcut ? `${label} (${opts.shortcut})` : label}
      disabled={opts.disabled}
      onClick={act}
    >
      <Icon name={icon} size={18} />
      {opts.text && <span>{opts.text}</span>}
    </button>
  );
  const plain = !armed;
  const undo = ed.store.undo;
  const wallButtons = (
    <>
      <span data-tour="plan-walls" className="plan-canvas__walltools">
        {toolButton(
          'walls',
          t('board.plan.tool.walls'),
          'wall',
          tool === 'walls' && plain,
          () => pickTool('walls'),
          { shortcut: 'W', text: t('board.plan.tool.walls') },
        )}
        {toolButton(
          'openings',
          t('board.plan.tool.openings'),
          'door',
          tool === 'openings' && plain,
          () => pickTool('openings'),
          { shortcut: 'D', text: t('board.plan.tool.openings') },
        )}
      </span>
    </>
  );
  const undoButton = toolButton('undo', t('board.plan.undo'), 'undo', false, () => undo.undo(), {
    disabled: !undo.canUndo(),
  });
  const desktopTools = walls.active ? (
    <div
      className="plan-float plan-canvas__tools"
      data-tour="plan-tools"
      role="toolbar"
      aria-label={t('board.plan.tools')}
    >
      {toolButton(
        'select',
        t('board.plan.tool.select'),
        'pointer',
        false,
        () => pickTool('select'),
        {
          shortcut: 'V',
        },
      )}
      {wallButtons}
      <span className="plan-float__sep" aria-hidden="true" />
      {undoButton}
      {walls.doneButton}
    </div>
  ) : (
    <div
      className="plan-float plan-canvas__tools"
      data-tour="plan-tools"
      role="toolbar"
      aria-label={t('board.plan.tools')}
    >
      {toolButton(
        'select',
        t('board.plan.tool.select'),
        'pointer',
        tool === 'select' && plain,
        () => pickTool('select'),
        { shortcut: 'V' },
      )}
      {wallButtons}
      <span className="plan-float__sep" aria-hidden="true" />
      {toolButton(
        'pencil',
        t('board.plan.tool.pencil'),
        'pen',
        tool === 'pencil' && plain,
        () => pickTool('pencil'),
        { shortcut: 'P' },
      )}
      {toolButton(
        'line',
        t('board.plan.tool.lineOrArrow'),
        lineTool,
        (tool === 'line' || tool === 'arrow') && plain,
        // Pressed again it turns into the other one (L and A too).
        () => pickTool(tool === lineTool ? (lineTool === 'line' ? 'arrow' : 'line') : lineTool),
        { shortcut: 'L / A' },
      )}
      {toolButton(
        'shape',
        t('board.plan.tool.shape'),
        shapeTool,
        (tool === 'rect' || tool === 'ellipse') && plain,
        () =>
          pickTool(tool === shapeTool ? (shapeTool === 'rect' ? 'ellipse' : 'rect') : shapeTool),
        { shortcut: 'Q / O' },
      )}
      {toolButton(
        'text',
        t('board.plan.tool.text'),
        'text',
        tool === 'text' && plain,
        () => pickTool('text'),
        { shortcut: 'T' },
      )}
      {toolButton(
        'measure',
        t('board.plan.tool.measure'),
        'ruler',
        tool === 'measure' && plain,
        () => pickTool('measure'),
        { shortcut: 'U' },
      )}
      <span className="plan-float__sep" aria-hidden="true" />
      {undoButton}
      <span className="plan-float__mirror">
        {toolButton('redo', t('board.plan.redo'), 'undo', false, () => undo.redo(), {
          disabled: !undo.canRedo(),
        })}
      </span>
    </div>
  );
  const drawOn =
    (['pencil', 'line', 'arrow', 'rect', 'ellipse', 'text'] as Tool[]).includes(tool) && plain;
  const phoneTools = (
    <nav
      className="plan-canvas__phone-tools"
      data-tour="plan-tools"
      aria-label={t('board.plan.tools')}
    >
      {toolButton(
        'select',
        t('board.plan.tool.select'),
        'pointer',
        tool === 'select' && plain,
        () => pickTool('select'),
        { text: t('board.plan.tool.select') },
      )}
      <span data-tour="plan-walls" className="plan-canvas__walltools">
        {toolButton(
          'walls',
          t('board.plan.tool.walls'),
          'wall',
          walls.active && plain,
          () => pickTool('walls'),
          { text: t('board.plan.tool.walls') },
        )}
      </span>
      {toolButton(
        'draw',
        t('board.plan.tool.draw'),
        'pen',
        drawOn,
        () => setMenu({ x: -1, y: -1 }),
        { text: t('board.plan.tool.draw') },
      )}
      {toolButton(
        'measure',
        t('board.plan.tool.measure'),
        'ruler',
        tool === 'measure' && plain,
        () => pickTool('measure'),
        { text: t('board.plan.tool.measure') },
      )}
      {toolButton(
        'library',
        t('board.plan.library'),
        'iconLibrary',
        ed.sheet === 'library',
        () => ed.setSheet(ed.sheet === 'library' ? null : 'library'),
        { text: t('board.plan.lib.short') },
      )}
    </nav>
  );
  const drawMenu: MenuItem[] = (
    ['pencil', 'line', 'arrow', 'rect', 'ellipse', 'text'] as const
  ).map((x) => ({
    label: t(`board.plan.tool.${x}`),
    icon: (x === 'pencil' ? 'pen' : x) as IconName,
    checked: tool === x && plain,
    action: () => pickTool(x),
  }));
  const zoomControl = (
    <fieldset className="plan-float plan-canvas__zoom" aria-label={t('board.plan.zoom')}>
      <IconButton
        icon="minus"
        label={t('board.plan.zoomOut')}
        disabled={zoom === ZOOMS[0]}
        onClick={() => zoomBy(-1)}
      />
      <span className="plan-canvas__percent" aria-live="polite">
        {zoom}%
      </span>
      <IconButton
        icon="plus"
        label={t('board.plan.zoomIn')}
        disabled={zoom === ZOOMS.at(-1)}
        onClick={() => zoomBy(1)}
      />
      <IconButton icon="fit" label={t('board.plan.zoomFit')} onClick={() => setZoom(100)} />
    </fieldset>
  );
  /** One metre on screen, when the plan has a scale. */
  const metrePx = drawn.scale && px ? (drawn.scale / PLAN_VIEW_W) * px : 0;
  const scaleBar = metrePx > 0 && (
    <div className="plan-canvas__scalebar" aria-hidden="true">
      <span>{metrePx < 24 ? '5 m' : '1 m'}</span>
      <i style={{ width: metrePx < 24 ? metrePx * 5 : metrePx }} />
    </div>
  );
  const rulers = !phone && drawn.scale && drawn.rulers && (
    <>
      <div className="plan-ruler plan-ruler--top" aria-hidden="true">
        {Array.from({ length: Math.floor(PLAN_VIEW_W / drawn.scale) + 1 }, (_, m) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a metre is its place on the ruler.
          <span key={m} style={{ left: `${((m * (drawn.scale as number)) / PLAN_VIEW_W) * 100}%` }}>
            {m === 1 ? '1 m' : m}
          </span>
        ))}
      </div>
      <div className="plan-ruler plan-ruler--left" aria-hidden="true">
        {Array.from({ length: Math.floor(PLAN_VIEW_H / drawn.scale) + 1 }, (_, m) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a metre is its place on the ruler.
          <span key={m} style={{ top: `${((m * (drawn.scale as number)) / PLAN_VIEW_H) * 100}%` }}>
            {m}
          </span>
        ))}
      </div>
    </>
  );

  const movingIcon = ed.movingIcon;
  const moveBar = movingIcon && (
    <div
      className="plan-float plan-canvas__movebar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.routeBar')}
    >
      <span>
        {t('board.plan.routeOf', {
          name: movingIcon.label || t(`board.plan.icons.${movingIcon.kind}`),
        })}
      </span>
      <span className="plan-float__sep" aria-hidden="true" />
      <IconButton
        icon="trash"
        label={t('board.plan.clearRoute')}
        onClick={() => {
          const next = { ...movingIcon };
          delete next.steps;
          delete next.note;
          delete next.dashed;
          ed.write(next);
        }}
      />
      <Button variant="primary" onClick={ed.endRoute}>
        {t('film.pen.done')}
      </Button>
    </div>
  );
  const metresDraft = scaleDraft ? Number(scaleDraft.metres.replace(',', '.')) : 0;
  const scaleOk =
    !!scaleDraft &&
    metresDraft >= 0.01 &&
    metresDraft < 1000 &&
    (scaleFor(scaleDraft.length, metresDraft) ?? Number.POSITIVE_INFINITY) <= MAX_SCALE;
  const scaleDialog = scaleDraft && (
    <div className="plan-scale ink-motion-pop" role="dialog" aria-label={t('board.plan.setScale')}>
      <div className="plan-scale__head">
        <b>{t('board.plan.setScale')}</b>
        <IconButton
          icon="close"
          label={t('board.plan.cancel')}
          onClick={() => setScaleDraft(null)}
        />
      </div>
      <label className="plan-scale__field">
        <span>{t('board.plan.lineIs')}</span>
        <span className="plan-num">
          <input
            inputMode="decimal"
            // biome-ignore lint/a11y/noAutofocus: the dialog opens to take this one number.
            autoFocus
            aria-label={t('board.plan.lineIs')}
            value={scaleDraft.metres}
            onChange={(e) => setScaleDraft({ ...scaleDraft, metres: e.target.value })}
          />
          <span>{t('board.plan.metres')}</span>
        </span>
      </label>
      <div className="plan-props__row">
        <span>{t('board.plan.grid')}</span>
        <fieldset className="plan-props__segmented" aria-label={t('board.plan.grid')}>
          {(['0.25', '0.5', '1'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={gridDraft === g}
              onClick={() => setGridDraft(g)}
            >
              {Number(g).toLocaleString(i18n.language)}
              {g === '1' ? ' m' : ''}
            </button>
          ))}
        </fieldset>
      </div>
      <label className="plan-props__row">
        <span>{t('board.plan.rulers')}</span>
        <Switch checked={rulersDraft} onChange={(e) => setRulersDraft(e.target.checked)} />
      </label>
      <div className="plan-scale__actions">
        <Button variant="ghost" onClick={() => setScaleDraft(null)}>
          {t('board.plan.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!scaleOk}
          onClick={() => {
            const next = scaleFor(scaleDraft.length, metresDraft);
            if (!next || !scaleOk) return;
            ed.change(() =>
              updateElement(
                ed.doc,
                ed.scaleOwner,
                {
                  scale: Math.round(next * 100) / 100,
                  grid: gridDraft,
                  rulers: rulersDraft || undefined,
                },
                LOCAL,
              ),
            );
            setScaleDraft(null);
          }}
        >
          {t('board.plan.apply')}
        </Button>
      </div>
    </div>
  );
  const measurePanel = measureDraft && (
    <div
      className="plan-pop plan-pop--measure ink-motion-pop"
      role="dialog"
      aria-label={t('board.plan.shapes.measure')}
      style={
        phone
          ? undefined
          : (() => {
              const r = stage.current?.getBoundingClientRect();
              if (!r) return undefined;
              const left = r.left + measureDraft.at.x * r.width - 135;
              const top = r.top + measureDraft.at.y * r.height;
              const low = top > window.innerHeight - 220;
              return {
                position: 'fixed',
                left: Math.max(8, Math.min(left, window.innerWidth - 278)),
                ...(low ? { bottom: window.innerHeight - top + 12 } : { top: top + 12 }),
              } as CSSProperties;
            })()
      }
    >
      {measureDraft.asking ? (
        <div className="plan-pop__ask">
          <b>{t('board.plan.noScaleYet')}</b>
          <p>
            {t('board.plan.useAsScale', {
              value: Number(measureDraft.asking).toLocaleString(i18n.language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            })}
          </p>
          <div className="plan-pop__actions">
            <Button variant="primary" onClick={measureAsScale}>
              {t('board.plan.useAsScaleYes')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                writeMeasure(measureDraft.id, measureDraft.asking as string);
                setMeasureDraft(null);
              }}
            >
              {t('board.plan.useAsScaleNo')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="plan-pop__row plan-pop__row--end">
            <label className="plan-pop__field">
              <span>{t('board.plan.shapes.measure')}</span>
              <input
                className={`plan-field${measureDraft.wrong ? ' is-wrong' : ''}`}
                inputMode="decimal"
                // biome-ignore lint/a11y/noAutofocus: the panel opens to take this one number.
                autoFocus
                aria-label={t('board.plan.measureMetres')}
                aria-invalid={measureDraft.wrong}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitMeasure();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setMeasureDraft(null);
                  }
                }}
                value={measureDraft.value}
                onChange={(e) =>
                  setMeasureDraft({ ...measureDraft, value: e.target.value, wrong: false })
                }
              />
            </label>
            <span className="plan-pop__unit">m</span>
            <Button variant="primary" onClick={commitMeasure}>
              {t('film.pen.done')}
            </Button>
          </div>
          {measureDraft.wrong ? (
            <p className="plan-pop__wrong" role="alert">
              {t('board.plan.measureWrong')}
            </p>
          ) : (
            <p className="plan-pop__text">{t('board.plan.measureHint')}</p>
          )}
        </>
      )}
    </div>
  );

  const marqueeCount = marquee
    ? withGroups(
        drawn,
        itemsInRect(
          drawn,
          {
            x: Math.min(marquee.a.x, marquee.b.x) * PLAN_VIEW_W,
            y: Math.min(marquee.a.y, marquee.b.y) * PLAN_VIEW_H,
            w: Math.abs(marquee.b.x - marquee.a.x) * PLAN_VIEW_W,
            h: Math.abs(marquee.b.y - marquee.a.y) * PLAN_VIEW_H,
          },
          viewOf,
        ),
      ).length
    : 0;
  const armedName = armed && t(`board.plan.icons.${armed}`);
  const isEmpty = planItems(drawn).length === 0 && !(drawn.walls?.length ?? 0) && !drawn.background;
  const hiddenList = [...ed.myHidden];
  const lifted = new Set(selection.map((r) => r.id));
  // A setup's base drawn faintly behind it: its own lights, cameras and people.
  const ghostPlan =
    ed.ghostBase && ed.base
      ? { ...ed.base, hiddenLayers: ['set' as const], walls: [], openings: [] }
      : null;
  const contextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = planItemAt(drawn, pointAt(e), viewOf);
    if (hit && !selection.some((r) => r.id === hit.id)) ed.select(hit);
    if (hit || selection.length) setMenu({ x: e.clientX, y: e.clientY });
  };
  const layerStatus = [
    ...[...ed.hiddenLayers].map((l) => t(`board.plan.hiddenAs.${l}`)),
    ...[...ed.locked].map((l) => t(`board.plan.lockedAs.${l}`)),
  ];

  return (
    <div className="plan-canvas">
      <div
        ref={scroller}
        className="plan-canvas__scroll"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) ed.setSelection([]);
        }}
        onWheel={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          zoomBy(e.deltaY < 0 ? 1 : -1);
        }}
      >
        <div
          className="plan-canvas__sheet"
          style={{ width: `calc(min(100cqw, ${PLAN_ASPECT * 100}cqh) * ${k})` }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the drawing is pointer work; the panels and keys give the same tools. */}
          <div
            ref={stage}
            className={`plan-editor__stage plan-editor__stage--${tool}`}
            onPointerDown={onPointerDown}
            onMouseDown={(e) => {
              if (measureDraft) e.preventDefault();
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={contextMenu}
          >
            {rulers}
            {ghostPlan && (
              <div className="plan-canvas__ghost" aria-hidden="true">
                <PlanDrawing plan={ghostPlan} moves={false} />
              </div>
            )}
            <PlanDrawing
              plan={
                placing.preview && shown.background
                  ? { ...shown, background: { ...shown.background, ...placing.preview } }
                  : shown
              }
              background
              grid={step}
              ghosts={ed.ghosts}
              route
              hidden={hiddenList}
              lifted={lifted}
              label={t('board.plan.drawing')}
            >
              {liveLayer}
            </PlanDrawing>
            {isEmpty && tool === 'select' && !armed && (
              <p className="plan-editor__empty">{t('board.plan.emptyHint')}</p>
            )}
            {marquee && !phone && (
              <span
                className="plan-editor__tool-label"
                style={{
                  left: `${Math.min(Math.max(marquee.a.x, marquee.b.x) * 100, 72)}%`,
                  top: `${Math.min(Math.max(marquee.a.y, marquee.b.y) * 100, 94)}%`,
                }}
              >
                {t('board.plan.marquee', { count: marqueeCount })}
              </span>
            )}
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
      </div>
      {moveBar}
      {placing.bar}
      {walls.options}
      {walls.palette}
      {walls.lockedNote}
      {layerStatus.length > 0 && !phone && (
        <p className="plan-canvas__status">{layerStatus.join(' · ')}</p>
      )}
      {tool === 'scale' && (
        <p className="plan-float plan-canvas__tip">{t('board.plan.scaleHint')}</p>
      )}
      {scaleDialog}
      {armed && armedName && (
        <p className="plan-float plan-canvas__toast ink-motion-pop" role="status">
          <span>{t(phone ? 'board.plan.placeTap' : 'board.plan.placeClick')}</span>
          <b>{armedName}</b>
          <Button variant="ghost" onClick={ed.disarm}>
            {t('board.plan.placeEnd')}
          </Button>
          {!phone && <kbd>Esc</kbd>}
        </p>
      )}
      {movingIcon && (
        <p className="plan-float plan-canvas__toast" role="status">
          {t(phone ? 'board.plan.routeHintPhone' : 'board.plan.routeHint', {
            number: (movingIcon.steps?.length ?? 0) + 2,
          })}
        </p>
      )}
      {marquee && phone && (
        <p className="plan-float plan-canvas__toast" role="status">
          {t('board.plan.marqueeHold', { count: marqueeCount })}
        </p>
      )}
      {!phone && scaleBar}
      {!phone && !movingIcon && !placing.active && desktopTools}
      {!phone && zoomControl}
      {phone && phoneTools}
      {measurePanel}
      {menu && (
        <ContextMenu
          className="plan-menu"
          label={menu.x < 0 ? t('board.plan.tool.draw') : t('board.plan.selectionMenu')}
          {...(menu.x < 0
            ? { style: { position: 'fixed', left: 8, bottom: 72 } as CSSProperties }
            : { x: menu.x, y: menu.y })}
          items={menu.x < 0 ? drawMenu : selectionMenu(ed, t)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
