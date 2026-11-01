// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanIcon,
  addShape,
  addStroke,
  canRotate,
  duplicatePlanItems,
  encodeStroke,
  iconCentre,
  iconExtent,
  moveItem,
  normalizeRotation,
  PLAN_GRID,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanItemRef,
  type Point,
  planItem,
  planItemAt,
  ROTATE_STEP,
  removePlanItems,
  rotateItem,
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
  STROKE_GRID,
  type Stroke,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName } from '@inkadra/ui';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ShapeView } from '../film/shapes.tsx';
import { pathOf } from '../film/strokes.ts';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { planTitle } from './PlanCard.tsx';
import {
  ICON_COLORS,
  PLAN_COLORS,
  PLAN_INK,
  PLAN_PEN,
  PLAN_TEXT,
  PlanDrawing,
  planCss,
} from './PlanDrawing.tsx';
import './plan.css';

type Tool = 'select' | 'pencil' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'icons';
type DragKind = Extract<Tool, 'line' | 'arrow' | 'rect' | 'ellipse'>;
type Item = Stroke | FrameShape | PlanIcon;

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
export const ICON_GLYPHS: Record<PlanIconKind, IconName> = {
  camera: 'planCamera',
  light: 'planLight',
  actor: 'planActor',
  door: 'planDoor',
  window: 'planWindow',
  table: 'planTable',
  track: 'planTrack',
};
/** A pointer that moves less than this (screen pixels) from a library tile taps it. */
const TAP_SLOP = 6;

interface TextDraft {
  at: Point;
  value: string;
}
type Gesture =
  | { kind: 'move'; ref: PlanItemRef; start: Point; item: Item }
  | { kind: 'rotate'; ref: PlanItemRef; centre: Point; from: number; item: Item }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'shape'; shape: DragKind; a: Point; b: Point };

/** View units of a point of the drawing (0 to 1). */
const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
const fromGrid = (x: number, y: number): Point => ({
  x: (x / STROKE_GRID) * PLAN_VIEW_W,
  y: (y / STROKE_GRID) * PLAN_VIEW_H,
});

/** Box of an item in view units, for the selection outline. */
export function itemBox(item: Item): { x: number; y: number; w: number; h: number } {
  let pts: Point[];
  if ('points' in item) {
    pts = [];
    for (let i = 0; i + 1 < item.points.length; i += 2)
      pts.push(fromGrid(item.points[i] as number, item.points[i + 1] as number));
  } else if ('x0' in item) {
    const a = fromGrid(item.x0, item.y0);
    if (item.kind === 'text') {
      const size = item.width;
      const w = size * 0.6 * (item.text?.length ?? 1);
      return { x: a.x, y: a.y - size, w, h: size * 1.25 };
    }
    pts = [a, fromGrid(item.x1, item.y1)];
  } else {
    const c = iconCentre(item);
    const e = iconExtent(item.kind);
    const t = ((item.rotation ?? 0) * Math.PI) / 180;
    const w = Math.abs(e.w * Math.cos(t)) + Math.abs(e.h * Math.sin(t));
    const h = Math.abs(e.w * Math.sin(t)) + Math.abs(e.h * Math.cos(t));
    return { x: c.x - w, y: c.y - h, w: w * 2, h: h * 2 };
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const replaceIn = <T extends { id: string }>(list: T[] | undefined, next: Item): T[] | undefined =>
  list?.map((item) => (item.id === next.id ? (next as unknown as T) : item));

/**
 * The editor of a set plan (#335): on a desktop it sits on the card, with the tools to its
 * left, the set icons to its right and the bar of the selected item under it; on a phone it
 * takes the whole screen. Every finished line, shape, icon or edit is one change of the
 * document, so it syncs as you go and undo goes back one gesture at a time. The tool, the
 * selection and the grid snap are local to this person.
 */
export function PlanEditor({
  store,
  plan,
  at,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  /** Where the card is on the screen, relative to the canvas; null on a phone. */
  at: { x: number; y: number; w: number; h: number; zoom: number } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = at === null;
  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<PlanIconKind>('camera');
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<PlanItemRef | null>(null);
  /** The item being moved or turned, shown in place until the gesture ends. */
  const [preview, setPreviewState] = useState<Item | null>(null);
  // The pointer-up handler reads the preview of the last move, which may not be rendered yet.
  const previewRef = useRef<Item | null>(null);
  const setPreview = (next: Item | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };
  const [live, setLive] = useState<Point[] | null>(null);
  const [liveShape, setLiveShape] = useState<{ kind: DragKind; a: Point; b: Point } | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const libDrag = useRef<{ kind: PlanIconKind; x: number; y: number; moved: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const doc = store.doc;
  const item = selected ? planItem(plan, selected) : undefined;
  const shown =
    preview === null
      ? plan
      : {
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

  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
  };
  const snapped = (p: Point) => (snap ? snapPlanPoint(p) : p);
  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const inside = (e: { clientX: number; clientY: number }) => {
    const p = pointAt(e);
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  };

  const placeIcon = (kind: PlanIconKind, p: Point) => {
    const q = snapped(p);
    let id: string | null = null;
    change(() => {
      id = addPlanIcon(
        doc,
        plan.id,
        { kind, color: ICON_COLORS[kind], x: toGrid(q.x), y: toGrid(q.y) },
        LOCAL,
      );
    });
    if (id) setSelected({ kind: 'icons', id });
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
      copies = duplicatePlanItems(
        doc,
        plan,
        [selected],
        { x: PLAN_GRID * 2, y: PLAN_GRID * 2 },
        LOCAL,
      );
    });
    if (copies[0]) setSelected(copies[0]);
  };
  const rotate = (degrees: number) => {
    if (!item || !canRotate(item)) return;
    change(() => updatePlanItems(doc, plan.id, [rotateItem(item, degrees)], LOCAL));
  };
  const recolor = (hex: string) => {
    if (!item) return;
    change(() => updatePlanItems(doc, plan.id, [{ ...item, color: hex }], LOCAL));
  };
  const relabel = (label: string) => {
    if (!item || !('x' in item)) return;
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
          color: PLAN_INK,
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
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
      else if (tool !== 'select') setTool('select');
      else onClose();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove();
    else if (mod && key === 'z') e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y') store.undo.redo();
    else if (mod && key === 'd' && selected) duplicate();
    else if (!mod && key === 'r' && selected) rotate(e.shiftKey ? -ROTATE_STEP : ROTATE_STEP);
    else if (!mod && key === 'i') setTool('icons');
    else if (!mod && key === 'g') setSnap((v) => !v);
    else if (!mod && TOOLS.some((x) => x.key.toLowerCase() === key))
      setTool(TOOLS.find((x) => x.key.toLowerCase() === key)?.tool ?? 'select');
    else return;
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
    const handle = (e.target as Element).closest('[data-rotate]');
    if (handle && item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = itemBox(item);
      const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const q = view(p);
      gesture.current = {
        kind: 'rotate',
        ref: selected as PlanItemRef,
        centre,
        from: Math.atan2(q.y - centre.y, q.x - centre.x),
        item,
      };
      return;
    }
    if (tool === 'select' || tool === 'icons') {
      const hit = planItemAt(plan, p);
      if (hit) {
        const target = planItem(plan, hit);
        setSelected(hit);
        if (!target) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        store.undo.stopCapturing();
        gesture.current = { kind: 'move', ref: hit, start: p, item: target };
        return;
      }
      if (tool === 'icons') {
        if ((plan.icons?.length ?? 0) < MAX_PLAN_ICONS) placeIcon(armed, p);
      } else setSelected(null);
      return;
    }
    setSelected(null);
    if (tool === 'text') {
      if ((plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
      e.preventDefault();
      const draft = { at: p, value: '' };
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
      if (snap && 'x' in g.item) {
        // An icon's centre lands on the grid.
        const c = iconCentre(g.item);
        const to = snapPlanPoint({ x: (c.x + d.x) / PLAN_VIEW_W, y: (c.y + d.y) / PLAN_VIEW_H });
        d = { x: view(to).x - c.x, y: view(to).y - c.y };
      }
      setPreview(moveItem(g.item, d));
    } else if (g.kind === 'rotate') {
      const q = view(p);
      const angle = Math.atan2(q.y - g.centre.y, q.x - g.centre.x);
      let degrees = ((angle - g.from) * 180) / Math.PI;
      if (snap) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      setPreview(rotateItem(g.item, normalizeRotation(degrees)));
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
    if (g.kind === 'move' || g.kind === 'rotate') {
      const next = previewRef.current;
      setPreview(null);
      if (next) change(() => updatePlanItems(doc, plan.id, [next], LOCAL));
      return;
    }
    if (g.kind === 'draw') {
      setLive(null);
      change(() =>
        addStroke(
          doc,
          plan.id,
          { tool: 'pencil', color: PLAN_INK, width: PLAN_PEN, points: encodeStroke(g.points) },
          LOCAL,
        ),
      );
      return;
    }
    const b = g.b;
    setLiveShape(null);
    const shape = {
      kind: g.shape,
      color: PLAN_INK,
      width: PLAN_PEN,
      x0: toGrid(g.a.x),
      y0: toGrid(g.a.y),
      x1: toGrid(b.x),
      y1: toGrid(b.y),
    };
    // A click without a drag draws nothing.
    if (Math.abs(shape.x1 - shape.x0) + Math.abs(shape.y1 - shape.y0) >= 8)
      change(() => addShape(doc, plan.id, shape, LOCAL));
  }

  // Set icons: a tap arms one for the next tap on the plan; a drag drops it where it lands.
  function onTileDown(e: PointerEvent<HTMLButtonElement>, kind: PlanIconKind) {
    e.stopPropagation();
    setArmed(kind);
    e.currentTarget.setPointerCapture(e.pointerId);
    libDrag.current = { kind, x: e.clientX, y: e.clientY, moved: false };
  }
  function onTileMove(e: PointerEvent<HTMLButtonElement>) {
    const d = libDrag.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) d.moved = true;
  }
  function onTileUp(e: PointerEvent<HTMLButtonElement>) {
    const d = libDrag.current;
    libDrag.current = null;
    if (d?.moved && inside(e)) placeIcon(d.kind, pointAt(e));
  }

  const box = current ? itemBox(current) : null;
  const pad = 8;
  const selection = box && (
    <g className="plan-editor__selection">
      <rect
        x={box.x - pad}
        y={box.y - pad}
        width={box.w + pad * 2}
        height={box.h + pad * 2}
        rx={4}
      />
      {current && canRotate(current) && (
        <g data-rotate="" className="plan-editor__rotate">
          <line x1={box.x + box.w / 2} y1={box.y - pad} x2={box.x + box.w / 2} y2={box.y - 40} />
          <circle cx={box.x + box.w / 2} cy={box.y - 48} r={12} />
        </g>
      )}
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
          style={{ color: planCss(PLAN_INK) }}
        />
      )}
      {liveShape && (
        <g style={{ color: planCss(PLAN_INK) }}>
          <ShapeView
            shape={{
              kind: liveShape.kind,
              color: PLAN_INK,
              width: PLAN_PEN,
              x0: toGrid(liveShape.a.x),
              y0: toGrid(liveShape.a.y),
              x1: toGrid(liveShape.b.x),
              y1: toGrid(liveShape.b.y),
            }}
            height={PLAN_VIEW_H}
            color="currentColor"
          />
        </g>
      )}
      {selection}
    </>
  );

  const title = planTitle(t, plan);
  const isIcon = !!current && 'x' in current;

  const tools = (
    <div
      className={`plan-editor__tools${phone ? ' plan-editor__tools--phone' : ''}`}
      role="toolbar"
      aria-label={t('board.plan.tools')}
      style={at ? { left: at.x - 52, top: at.y + 8 } : undefined}
    >
      {TOOLS.filter((x) => !phone || x.phone).map((x) => (
        <button
          key={x.tool}
          type="button"
          className="plan-editor__btn"
          aria-pressed={tool === x.tool}
          aria-label={t(`board.plan.tool.${x.tool}`)}
          data-ink-tooltip={`${t(`board.plan.tool.${x.tool}`)} (${x.key})`}
          onClick={() => setTool(x.tool)}
        >
          <Icon name={x.icon} size={16} />
        </button>
      ))}
      <span className="plan-editor__sep" aria-hidden="true" />
      <button
        type="button"
        className="plan-editor__btn"
        aria-pressed={tool === 'icons'}
        aria-label={t('board.plan.tool.icons')}
        data-ink-tooltip={`${t('board.plan.tool.icons')} (I)`}
        onClick={() => setTool('icons')}
      >
        <Icon name="planCamera" size={16} />
      </button>
      {!phone && (
        <>
          <span className="plan-editor__sep" aria-hidden="true" />
          <button
            type="button"
            className="plan-editor__btn plan-editor__btn--snap"
            aria-pressed={snap}
            aria-label={t('board.plan.snap')}
            data-ink-tooltip={`${t('board.plan.snap')} (G)`}
            onClick={() => setSnap((v) => !v)}
          >
            <Icon name="guides" size={16} />
          </button>
        </>
      )}
    </div>
  );

  const library = tool === 'icons' && !(phone && current) && (
    <div
      className={`plan-editor__lib ink-motion-pop${phone ? ' plan-editor__lib--phone' : ''}`}
      style={at ? { left: at.x + at.w + 22, top: at.y + 8 } : undefined}
    >
      {!phone && <div className="plan-editor__label">{t('board.plan.library')}</div>}
      <fieldset className="plan-editor__grid" aria-label={t('board.plan.library')}>
        {PLAN_ICON_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="plan-editor__tile"
            aria-pressed={armed === kind}
            aria-label={t(`board.plan.icons.${kind}`)}
            onPointerDown={(e) => onTileDown(e, kind)}
            onPointerMove={onTileMove}
            onPointerUp={onTileUp}
          >
            <Icon name={ICON_GLYPHS[kind]} size={phone ? 22 : 28} />
            {!phone && <span>{t(`board.plan.icons.${kind}`)}</span>}
          </button>
        ))}
      </fieldset>
      {!phone && <p className="plan-editor__hint">{t('board.plan.libraryHint')}</p>}
    </div>
  );

  const bar = current && (
    <div
      className={`plan-editor__bar ink-motion-pop${phone ? ' plan-editor__bar--phone' : ''}`}
      role="toolbar"
      aria-label={t('board.plan.selection')}
      style={at ? { left: at.x + 56, top: at.y + at.h + 8 } : undefined}
    >
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
      {isIcon && (
        <>
          <span className="plan-editor__vr" aria-hidden="true" />
          <input
            className="plan-editor__field"
            aria-label={t('board.plan.labelField')}
            placeholder={t('board.plan.labelPlaceholder')}
            maxLength={60}
            value={(current as PlanIcon).label ?? ''}
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
        </>
      )}
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="rotateRight"
        label={`${t('board.plan.rotate')} (R)`}
        disabled={!canRotate(current)}
        onClick={() => rotate(ROTATE_STEP)}
      />
      <IconButton icon="copy" label={t('board.plan.duplicate')} onClick={duplicate} />
      <IconButton icon="trash" label={t('board.plan.delete')} onClick={remove} />
    </div>
  );

  const sheet = (
    <div
      className="plan plan-editor__sheet"
      style={
        at
          ? {
              left: at.x,
              top: at.y,
              width: at.w / at.zoom,
              transform: `scale(${at.zoom})`,
            }
          : undefined
      }
    >
      {!phone && (
        <div className="plan__head">
          <Icon name="map" size={14} />
          <span className="plan__title">{t('board.plan.name')} ·</span>
          <input
            className="plan-editor__title"
            aria-label={t('board.plan.titleField')}
            placeholder={t('board.plan.titlePlaceholder')}
            maxLength={200}
            defaultValue={plan.title ?? ''}
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
        </div>
      )}
      <div
        ref={stage}
        className={`plan__body plan-editor__stage plan-editor__stage--${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <PlanDrawing plan={shown} grid>
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
  );

  // On the body: over the phone's navigation bar, which the canvas does not cover.
  if (phone)
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
        <div className="plan-editor__phone-stage">{sheet}</div>
        {library}
        {bar}
        {tools}
      </div>,
      document.body,
    );
  return (
    <div className="plan-editor" data-chrome="" role="dialog" aria-label={title}>
      {tools}
      {sheet}
      {library}
      {bar}
    </div>
  );
}
