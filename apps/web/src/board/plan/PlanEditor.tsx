// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanIcon,
  addShape,
  addStroke,
  categoryOf,
  duplicatePlanItems,
  encodeStroke,
  gridStep,
  itemBox,
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
  type PlanShape,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName } from '@inkadra/ui';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { pathOf } from '../film/strokes.ts';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { planTitle } from './PlanCard.tsx';
import {
  iconColor,
  NOTE_COLOR,
  PLAN_COLORS,
  PLAN_INK,
  PLAN_PEN,
  PLAN_TEXT,
  PlanDrawing,
  PlanShapeView,
  planCss,
} from './PlanDrawing.tsx';
import { type LibraryItem, PlanLibrary, rememberRecent } from './PlanLibrary.tsx';
import './plan.css';

type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'zone' | 'measure';
type Tool = 'select' | 'pencil' | 'text' | 'icons' | DragKind;
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
  | { kind: 'shape'; shape: DragKind; a: Point; b: Point };

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
  header,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  phone: boolean;
  /** More of the header: the scenes of the plan, its variants. */
  header?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<LibraryItem | null>(null);
  const [panel, setPanel] = useState<Panel>('icons');
  const [snap, setSnap] = useState(true);
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
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (armed) {
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
    else if (!mod && TOOLS.some((x) => x.key.toLowerCase() === key)) {
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
    } else if (g.kind === 'rotate') {
      const q = view(p);
      const angle = Math.atan2(q.y - g.centre.y, q.x - g.centre.x);
      let degrees = ((angle - g.from) * 180) / Math.PI;
      if (snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
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
      <g data-rotate="" className="plan-editor__rotate">
        <line x1={box.x + box.w / 2} y1={box.y - pad} x2={box.x + box.w / 2} y2={box.y - 40} />
        <circle cx={box.x + box.w / 2} cy={box.y - 48} r={12} />
      </g>
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
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="rotateRight"
        label={`${t('board.plan.rotate')} (R)`}
        onClick={() => rotate(ROTATE_STEP)}
      />
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

  const properties = current ? (
    <div className="plan-props">
      <h3 className="plan-props__title">
        {iconName(current)}
        {isIcon(current) && current.label && <span> · {current.label}</span>}
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
      {isIcon(current) && (
        <p className="plan-props__hint">
          {t(`board.plan.categories.${categoryOf(current.kind).id}`)} ·{' '}
          {t(`board.plan.layers.${layerOf(current)}`)}
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
          <PlanDrawing plan={shown} grid={step}>
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
          {header}
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
