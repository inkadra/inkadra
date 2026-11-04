import {
  addShape,
  addStroke,
  clearDrawing,
  encodeStroke,
  type FrameElement,
  type Point,
  removeShapes,
  removeStrokes,
  shapeHit,
  strokeHit,
  toGrid,
  updateElement,
} from '@inkadra/canvas-core';
import {
  ASPECT_RATIOS,
  type AspectRatio,
  MAX_SHAPES,
  MAX_STROKES,
  type Stroke,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName, Select } from '@inkadra/ui';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { aspectLabel, frameRatio } from './aspect.ts';
import { FrameUploadState, uploadToFrame } from './frame-upload.tsx';
import { FramePicture } from './FramePicture.tsx';
import { DRAG_SHAPES, type ShapeKind, ShapeView } from './shapes.tsx';
import { PEN_COLOR_NAMES, PEN_COLORS, PENS, type PenTool, pathOf, VIEW_W } from './strokes.ts';

type Tool = PenTool | 'shape' | 'text' | 'pan';
type DragShape = (typeof DRAG_SHAPES)[number];
/** Line width of each pen and of shapes; font size of texts. */
type Widths = Record<Stroke['tool'] | 'shape' | 'text', number>;

/** Moving the view has no tool of its own: space and drag, the wheel, or two fingers. */
const TOOLS: Array<{ tool: Exclude<Tool, 'pan'>; icon: IconName; key: string }> = [
  { tool: 'pencil', icon: 'pen', key: 'P' },
  { tool: 'brush', icon: 'brush', key: 'B' },
  { tool: 'marker', icon: 'marker', key: 'M' },
  { tool: 'eraser', icon: 'eraser', key: 'E' },
  { tool: 'shape', icon: 'rect', key: 'R' },
  { tool: 'text', icon: 'text', key: 'T' },
];
const SHAPE_ICONS: Record<DragShape, IconName> = {
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
};
const WIDTH_RANGE: Record<keyof Widths, [number, number]> = {
  pencil: [1, 40],
  brush: [1, 40],
  marker: [1, 80],
  shape: [1, 40],
  text: [10, 120],
};
const ERASER_RADIUS = 0.012;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

interface TextDraft {
  frameId: string;
  at: Point;
  value: string;
}

/**
 * Shift held: a square or a circle, or a line at a multiple of 45 degrees. Points are relative
 * to the picture; `ratio` (width / height) measures both axes alike.
 */
function constrain(kind: ShapeKind, a: Point, b: Point, ratio: number): Point {
  const dx = (b.x - a.x) * ratio;
  const dy = b.y - a.y;
  if (kind === 'rect' || kind === 'ellipse') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + (Math.sign(dx) * side) / ratio, y: a.y + Math.sign(dy) * side };
  }
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + (length * Math.cos(angle)) / ratio, y: a.y + length * Math.sin(angle) };
}

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * Full-screen editor for the drawing of a frame: pen strokes, shapes and texts over the
 * reference picture. Each finished line, shape or text is one item in the document, so the
 * drawing syncs item by item and undo goes back one gesture at a time. Zoom
 * and pan are local to this person.
 */
export function DrawingEditor({
  store,
  frame,
  label,
  boardAspect,
  readOnly,
  projectId,
  boardId,
  frames,
  onPick,
  onClose,
}: {
  store: BoardStore;
  frame: FrameElement;
  label: string;
  boardAspect: AspectRatio;
  readOnly: boolean;
  userId?: string | null;
  /** Needed to upload a reference picture from the editor. */
  projectId?: string;
  boardId?: string;
  /** Frames in shooting order for arrow navigation. */
  frames?: readonly FrameElement[];
  labels?: ReadonlyMap<string, string>;
  /** Opens the drawing of another frame. */
  onPick?: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const [tool, setTool] = useState<Tool>(readOnly ? 'pan' : 'pencil');
  const [shapeKind, setShapeKind] = useState<DragShape>('rect');
  const [color, setColor] = useState(frame.assetId ? '#E5484D' : '#1C1C1E');
  const [widths, setWidths] = useState<Widths>(() => ({
    pencil: PENS.pencil.width,
    brush: PENS.brush.width,
    marker: PENS.marker.width,
    shape: 4,
    text: 40,
  }));
  const [live, setLive] = useState<Point[] | null>(null);
  const [liveShape, setLiveShape] = useState<{ a: Point; b: Point } | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [popover, setPopover] = useState<'tools' | 'shape' | 'color' | 'width' | 'more' | null>(
    null,
  );
  const points = useRef<Point[] | null>(null);
  const shapeStart = useRef<Point | null>(null);
  const panning = useRef<{ x: number; y: number; from: Point } | null>(null);
  const fingers = useRef(new Map<number, Point>());
  const pinch = useRef<{ center: Point; distance: number; zoom: number; pan: Point } | null>(null);
  const space = useRef(false);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ratio = frameRatio(frame.aspect, boardAspect);
  const strokes = frame.strokes ?? [];
  const shapes = frame.shapes ?? [];
  const pen = tool === 'pencil' || tool === 'brush' || tool === 'marker' ? tool : null;
  const sized: keyof Widths | null = pen ?? (tool === 'shape' || tool === 'text' ? tool : null);
  const full = pen ? strokes.length >= MAX_STROKES : shapes.length >= MAX_SHAPES;
  const canUpload = !readOnly && !!projectId && !!boardId;

  const sequence = frames ?? [frame];
  const at = sequence.findIndex((f) => f.id === frame.id);
  const prev = at > 0 ? sequence[at - 1] : undefined;
  const next = at >= 0 ? sequence[at + 1] : undefined;
  const goPrev = prev && onPick ? () => onPick(prev.id) : undefined;
  const goNext = next && onPick ? () => onPick(next.id) : undefined;

  // The picture fills the stage at the frame's aspect ratio; zoom scales it from there.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const resize = () => {
      const w = Math.min(el.clientWidth, el.clientHeight * ratio);
      setBox({ w, h: w / ratio });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, [ratio]);

  // Another frame: back to the whole picture, and a text being typed is kept on its frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the frame changes.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    return () => commitTextFor.current();
  }, [frame.id]);

  /** Zooms keeping the point under `c` (client coordinates; the centre if omitted) still. */
  const zoomTo = (target: number, c?: { x: number; y: number }) => {
    const next = clampZoom(target);
    const r = stage.current?.getBoundingClientRect();
    if (!r) return setZoom(next);
    const cx = (c ? c.x : r.left + r.width / 2) - (r.left + r.width / 2);
    const cy = (c ? c.y : r.top + r.height / 2) - (r.top + r.height / 2);
    const k = next / zoom;
    setPan({ x: cx - k * (cx - pan.x), y: cy - k * (cy - pan.y) });
    setZoom(next);
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Ctrl (⌘) + wheel or a pinch zooms; the wheel alone pans.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomTo(zoom * Math.exp(-e.deltaY / 300), e);
    else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const on = (e: WheelEvent) => wheel.current(e);
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (e.key === 'Tab' && e.type === 'keydown') {
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not([type="file"]):not(:disabled), [tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (e.shiftKey && (target === first || target === dialog.current)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (target === last || target === dialog.current)) {
        e.preventDefault();
        first?.focus();
      }
      e.stopImmediatePropagation();
      return;
    }
    const escapingSlider =
      e.key === 'Escape' && target instanceof HTMLInputElement && target.type === 'range';
    if ((target?.tagName === 'INPUT' || target?.tagName === 'SELECT') && !escapingSlider) return;
    // The canvas behind listens on window too: the editor has the keyboard while open.
    e.stopImmediatePropagation();
    if (e.key === ' ') {
      space.current = e.type === 'keydown';
      if (target?.tagName !== 'BUTTON') e.preventDefault();
      return;
    }
    if (e.type !== 'keydown') return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (popover) setPopover(null);
      else onClose();
    } else if (mod && key === 'z' && !readOnly) e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y' && !readOnly) store.undo.redo();
    else if (!mod && e.key === 'ArrowLeft' && goPrev) goPrev();
    else if (!mod && e.key === 'ArrowRight' && goNext) goNext();
    else if (!mod && (e.key === '+' || e.key === '=')) zoomTo(zoom * ZOOM_STEP);
    else if (!mod && e.key === '-') zoomTo(zoom / ZOOM_STEP);
    else if (!mod && e.key === '0') resetView();
    else if (!mod && key === 'i' && canUpload) fileInput.current?.click();
    else if (!mod && !readOnly) {
      const picked = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (!picked) return;
      setTool(picked.tool);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    window.addEventListener('keyup', on, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      window.removeEventListener('keyup', on, true);
    };
  }, []);

  useEffect(() => {
    if (text) textInput.current?.focus();
  }, [text]);

  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = area.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

  const erase = (p: Point) => {
    const hitStrokes = strokes.filter((s) => strokeHit(s, p, ERASER_RADIUS)).map((s) => s.id);
    const hitShapes = shapes.filter((s) => shapeHit(s, p, ERASER_RADIUS, ratio)).map((s) => s.id);
    if (hitStrokes.length > 0) removeStrokes(store.doc, frame.id, hitStrokes, LOCAL);
    if (hitShapes.length > 0) removeShapes(store.doc, frame.id, hitShapes, LOCAL);
  };

  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
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
        store.doc,
        draft.frameId,
        { kind: 'text', color, width: widths.text, x0: x, y0: y, x1: x, y1: y, text: value },
        LOCAL,
      ),
    );
  };
  const commitTextFor = useRef(commitText);
  commitTextFor.current = commitText;

  /** The stage centre and the distance of two fingers, in the terms of `pan`. */
  const pinchOf = () => {
    const [a, b] = [...fingers.current.values()];
    const r = stage.current?.getBoundingClientRect();
    if (!a || !b || !r) return null;
    return {
      center: {
        x: (a.x + b.x) / 2 - (r.left + r.width / 2),
        y: (a.y + b.y) / 2 - (r.top + r.height / 2),
      },
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    };
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.pen__text')) return;
    if (e.pointerType === 'touch') {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = fingers.current.size === 2 ? pinchOf() : null;
      if (now) {
        // The second finger makes it a gesture: what the first one began is not a line.
        e.currentTarget.setPointerCapture(e.pointerId);
        points.current = null;
        shapeStart.current = null;
        panning.current = null;
        setLive(null);
        setLiveShape(null);
        pinch.current = { ...now, zoom, pan };
        return;
      }
    }
    const p = pointAt(e);
    const panGesture =
      e.button === 1 ||
      (e.button === 0 && (readOnly || tool === 'pan' || space.current || !inside(p)));
    if (text) {
      // A click away from the text being typed finishes it.
      commitText();
      if (!panGesture) return;
    }
    if (panGesture) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panning.current = { x: e.clientX, y: e.clientY, from: pan };
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'text') {
      if (full) return;
      e.preventDefault();
      const draft = { frameId: frame.id, at: p, value: '' };
      textRef.current = draft;
      setText(draft);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    store.undo.stopCapturing();
    if (tool === 'eraser') {
      erase(p);
      points.current = [p];
      return;
    }
    if (full) return;
    if (tool === 'shape') {
      shapeStart.current = p;
      setLiveShape({ a: p, b: p });
      return;
    }
    points.current = [p];
    setLive([p]);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (fingers.current.has(e.pointerId))
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinched = pinch.current;
    if (pinched) {
      const now = pinchOf();
      if (!now) return;
      const next = clampZoom((pinched.zoom * now.distance) / pinched.distance);
      const k = next / pinched.zoom;
      setZoom(next);
      setPan({
        x: now.center.x - k * (pinched.center.x - pinched.pan.x),
        y: now.center.y - k * (pinched.center.y - pinched.pan.y),
      });
      return;
    }
    const cursorPoint = pointAt(e);
    setCursor(inside(cursorPoint) ? cursorPoint : null);
    const drag = panning.current;
    if (drag) {
      setPan({ x: drag.from.x + e.clientX - drag.x, y: drag.from.y + e.clientY - drag.y });
      return;
    }
    const start = shapeStart.current;
    if (start) {
      const b = pointAt(e);
      setLiveShape({ a: start, b: e.shiftKey ? constrain(shapeKind, start, b, ratio) : b });
      return;
    }
    const current = points.current;
    if (!current) return;
    // Coalesced events keep fast lines smooth on pens and fast mice.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const p = pointAt(ev);
      if (!pen) erase(p);
      else current.push(p);
    }
    if (pen) setLive([...current]);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    fingers.current.delete(e.pointerId);
    if (pinch.current) {
      if (fingers.current.size < 2) pinch.current = null;
      return;
    }
    if (panning.current) {
      panning.current = null;
      return;
    }
    const start = shapeStart.current;
    if (start) {
      shapeStart.current = null;
      const b = liveShape?.b ?? start;
      setLiveShape(null);
      const shape = {
        kind: shapeKind,
        color,
        width: widths.shape,
        x0: toGrid(start.x),
        y0: toGrid(start.y),
        x1: toGrid(b.x),
        y1: toGrid(b.y),
      };
      // A click without a drag draws nothing.
      if (Math.abs(shape.x1 - shape.x0) + Math.abs(shape.y1 - shape.y0) >= 8)
        addShape(store.doc, frame.id, shape, LOCAL);
      store.undo.stopCapturing();
      return;
    }
    const current = points.current;
    points.current = null;
    setLive(null);
    if (!current || !pen) {
      store.undo.stopCapturing();
      return;
    }
    const encoded = encodeStroke(current);
    addStroke(
      store.doc,
      frame.id,
      { tool: pen, color, width: widths[pen], points: encoded },
      LOCAL,
    );
    store.undo.stopCapturing();
  }

  const height = VIEW_W / ratio;
  const liveStroke = live && pen && (
    <path
      d={pathOf(live, height)}
      fill="none"
      stroke={color}
      strokeWidth={widths[pen]}
      strokeOpacity={PENS[pen].opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  const liveShapeView = liveShape && (
    <ShapeView
      shape={{
        kind: shapeKind,
        color,
        width: widths.shape,
        x0: toGrid(liveShape.a.x),
        y0: toGrid(liveShape.a.y),
        x1: toGrid(liveShape.b.x),
        y1: toGrid(liveShape.b.y),
      }}
      height={height}
    />
  );
  const title = t('film.pen.title', { label });
  const colorLabel = t('film.pen.colorCurrent', {
    color: t(`film.pen.colorNames.${PEN_COLOR_NAMES[color]}`),
  });
  const percent = Math.round(zoom * 100);

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      className="pen"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="pen__bar">
        <span className="pen__title">{title}</span>
        {goPrev && (
          <IconButton
            icon="chevronRight"
            className="pen__prev"
            label={t('film.pen.prev')}
            onClick={goPrev}
          />
        )}
        {goNext && <IconButton icon="chevronRight" label={t('film.pen.next')} onClick={goNext} />}
        <span className="pen__escape">{t('film.pen.escape')}</span>
        <span className="ink-header__spacer" />
        <fieldset className="pen__view" aria-label={t('film.pen.view')}>
          <span className="pen__zoom">
            <IconButton
              icon="minus"
              label={t('film.pen.zoomOut')}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomTo(zoom / ZOOM_STEP)}
            />
            <button
              type="button"
              className="pen__zoom-value"
              aria-label={t('film.pen.zoomReset', { percent })}
              data-ink-tooltip={`${t('film.pen.zoomReset', { percent })} (0)`}
              onClick={resetView}
            >
              {percent}%
            </button>
            <IconButton
              icon="plus"
              label={t('film.pen.zoomIn')}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => zoomTo(zoom * ZOOM_STEP)}
            />
          </span>
        </fieldset>
      </header>
      <div className="pen__main">
        {!readOnly && (
          <div className="pen__tools" role="toolbar" aria-label={title}>
            <div className="pen__tool-picker">
              <IconButton
                icon={TOOLS.find((x) => x.tool === tool)?.icon ?? 'pen'}
                label={t('film.pen.tools')}
                onClick={() => setPopover(popover === 'tools' ? null : 'tools')}
              />
            </div>
            <div className={`pen__tool-list${popover === 'tools' ? ' is-open' : ''}`}>
              {TOOLS.flatMap((x) => [
                ...(x.tool === 'shape'
                  ? [<span key="sep" className="toolbar__sep" aria-hidden="true" />]
                  : []),
                <button
                  key={x.tool}
                  type="button"
                  className="toolbar__btn"
                  aria-pressed={tool === x.tool}
                  aria-label={t(`film.pen.${x.tool}`)}
                  data-ink-tooltip={`${t(`film.pen.${x.tool}`)} (${x.key})`}
                  onClick={() => {
                    setTool(x.tool);
                    setPopover(x.tool === 'shape' ? 'shape' : null);
                  }}
                >
                  <Icon name={x.tool === 'shape' ? SHAPE_ICONS[shapeKind] : x.icon} size={16} />
                </button>,
              ])}
            </div>
            {tool === 'shape' && popover === 'shape' && (
              <div className="pen__popover pen__shapes">
                <span className="toolbar__sep" aria-hidden="true" />
                {DRAG_SHAPES.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="toolbar__btn"
                    aria-pressed={shapeKind === kind}
                    aria-label={t(`film.pen.shapes.${kind}`)}
                    data-ink-tooltip={t(`film.pen.shapes.${kind}`)}
                    onClick={() => {
                      setShapeKind(kind);
                      setPopover(null);
                    }}
                  >
                    <Icon name={SHAPE_ICONS[kind]} size={16} />
                  </button>
                ))}
              </div>
            )}
            <span className="toolbar__sep" aria-hidden="true" />
            <button
              type="button"
              className="toolbar__btn"
              aria-expanded={popover === 'color'}
              aria-label={colorLabel}
              data-ink-tooltip={colorLabel}
              onClick={() => setPopover(popover === 'color' ? null : 'color')}
            >
              <span className="pen__current-color" style={{ background: color }} />
            </button>
            {popover === 'color' && (
              <div className="pen__popover pen__colors">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="pen__swatch"
                    style={{ background: c }}
                    aria-pressed={color === c}
                    aria-label={t('film.pen.color', {
                      color: t(`film.pen.colorNames.${PEN_COLOR_NAMES[c]}`),
                    })}
                    onClick={() => {
                      setColor(c);
                      if (tool === 'eraser') setTool('pencil');
                    }}
                  />
                ))}
              </div>
            )}
            <IconButton
              icon="lineWidth"
              label={t('film.pen.width')}
              onClick={() => setPopover(popover === 'width' ? null : 'width')}
            />
            {sized && popover === 'width' && (
              <label className="pen__width pen__popover">
                <span>{t(sized === 'text' ? 'film.pen.textSize' : 'film.pen.width')}</span>
                <input
                  type="range"
                  min={WIDTH_RANGE[sized][0]}
                  max={WIDTH_RANGE[sized][1]}
                  value={widths[sized]}
                  onChange={(e) => setWidths((w) => ({ ...w, [sized]: Number(e.target.value) }))}
                />
              </label>
            )}
            <span className="toolbar__sep" aria-hidden="true" />
            <IconButton
              icon="undo"
              label={t('film.pen.undo')}
              disabled={!store.undo.canUndo()}
              onClick={() => store.undo.undo()}
            />
            <IconButton
              icon="undo"
              className="pen__redo"
              label={t('film.pen.redo')}
              disabled={!store.undo.canRedo()}
              onClick={() => store.undo.redo()}
            />
            <span className="toolbar__sep" aria-hidden="true" />
            <IconButton
              icon="more"
              label={t('film.pen.more')}
              onClick={() => setPopover(popover === 'more' ? null : 'more')}
            />
            {popover === 'more' && (
              <div className="pen__popover pen__more">
                {frame.assetId && (
                  <label className="pen__opacity">
                    <span className="pen__opacity-label">
                      {t('film.pen.opacity')}
                      <small>{Math.round((frame.referenceOpacity ?? 1) * 100)}%</small>
                    </span>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={5}
                      value={Math.round((frame.referenceOpacity ?? 1) * 100)}
                      onChange={(e) =>
                        change(() =>
                          updateElement(
                            store.doc,
                            frame.id,
                            { referenceOpacity: Number(e.target.value) / 100 },
                            LOCAL,
                          ),
                        )
                      }
                    />
                  </label>
                )}
                {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
                <label className="pen__aspect">
                  <span>{t('film.aspect.label')}</span>
                  <Select
                    className="ink-input"
                    value={frame.aspect ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      change(() =>
                        updateElement(
                          store.doc,
                          frame.id,
                          { aspect: (e || undefined) as AspectRatio | undefined },
                          LOCAL,
                        ),
                      )
                    }
                  >
                    <option value="">
                      {t('film.aspect.board', { ratio: aspectLabel(boardAspect) })}
                    </option>
                    {ASPECT_RATIOS.map((r) => (
                      <option key={r} value={r}>
                        {aspectLabel(r)}
                      </option>
                    ))}
                  </Select>
                </label>
                {canUpload && (
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="image" size={16} />
                    {t(frame.assetId ? 'film.pen.referenceReplace' : 'film.pen.reference')}
                  </button>
                )}
                <hr className="menu__divider" />
                <button
                  type="button"
                  className="menu__item is-danger"
                  disabled={strokes.length === 0 && shapes.length === 0}
                  onClick={() => change(() => clearDrawing(store.doc, frame.id, LOCAL))}
                >
                  <Icon name="trash" size={16} />
                  {t('film.pen.clear')}
                </button>
              </div>
            )}
            <span className="toolbar__sep" aria-hidden="true" />
            <Button variant="primary" onClick={onClose}>
              {t('film.pen.done')}
            </Button>
          </div>
        )}
        {readOnly && (
          <Button className="pen__close" onClick={onClose}>
            {t('viewer.close')}
          </Button>
        )}
        <div className="pen__center">
          {/* Drawing happens with the pointer; the toolbar and the keys give the same tools. */}
          <div
            className={`pen__stage pen__stage--${tool}`}
            ref={stage}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setCursor(null)}
          >
            <div
              ref={area}
              className="pen__area"
              style={{
                width: box.w,
                height: box.h,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <FramePicture
                assetId={frame.assetId}
                aspect={frame.aspect}
                boardAspect={boardAspect}
                strokes={strokes}
                shapes={shapes}
                referenceOpacity={frame.referenceOpacity}
                pixels={box.w * zoom * (window.devicePixelRatio || 1)}
              >
                {liveStroke}
                {liveShapeView}
              </FramePicture>
              <FrameUploadState frameId={frame.id} />
              {cursor && pen && !readOnly && (
                <span
                  aria-hidden="true"
                  className="pen__cursor"
                  style={{
                    left: `${cursor.x * 100}%`,
                    top: `${cursor.y * 100}%`,
                    width: (widths[pen] * box.w) / VIEW_W,
                    height: (widths[pen] * box.w) / VIEW_W,
                    borderColor: color,
                  }}
                />
              )}
              {text && (
                <input
                  ref={textInput}
                  className="pen__text"
                  aria-label={t('film.pen.textField')}
                  placeholder={t('film.pen.textPlaceholder')}
                  maxLength={500}
                  value={text.value}
                  style={{
                    left: `${text.at.x * 100}%`,
                    top: `${text.at.y * 100}%`,
                    color,
                    fontSize: (widths.text * box.w) / VIEW_W,
                  }}
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
            {full && !readOnly && (
              <p className="pen__full" role="status">
                {t(pen ? 'film.pen.full' : 'film.pen.fullShapes')}
              </p>
            )}
          </div>
        </div>
      </div>
      {canUpload && (
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file || !projectId || !boardId) return;
            uploadToFrame({ store, frameId: frame.id, file, projectId, boardId });
          }}
        />
      )}
    </div>
  );
}
