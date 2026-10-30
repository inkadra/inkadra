import { Select } from '@inkadra/ui';
import {
  addFrame,
  addShape,
  addStroke,
  childrenOf,
  clearDrawing,
  encodeStroke,
  type FrameElement,
  listElements,
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
  type FrameShape,
  MAX_SHAPES,
  MAX_STROKES,
  type Stroke,
} from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName } from '@inkadra/ui';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { startUpload } from '../uploads.ts';
import { aspectLabel, frameRatio } from './aspect.ts';
import { FramePicture, StrokePath } from './FramePicture.tsx';
import { DRAG_SHAPES, type ShapeKind, ShapeView } from './shapes.tsx';
import { PEN_COLORS, PENS, type PenTool, pathOf, VIEW_W } from './strokes.ts';

type Tool = PenTool | 'shape' | 'text' | 'pan';
type DragShape = (typeof DRAG_SHAPES)[number];
/** Line width of each pen and of shapes; font size of texts. */
type Widths = Record<Stroke['tool'] | 'shape' | 'text', number>;

const TOOLS: Array<{ tool: Tool; icon: IconName; key: string }> = [
  { tool: 'pencil', icon: 'pen', key: 'P' },
  { tool: 'brush', icon: 'brush', key: 'B' },
  { tool: 'marker', icon: 'marker', key: 'M' },
  { tool: 'eraser', icon: 'eraser', key: 'E' },
  { tool: 'shape', icon: 'rect', key: 'R' },
  { tool: 'text', icon: 'text', key: 'T' },
  { tool: 'pan', icon: 'hand', key: 'H' },
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
/** Colour of the previous frame under the drawing. */
const ONION_COLOR = '#3E7BFA';

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
 * drawing syncs item by item and undo goes back one gesture at a time. Zoom, pan, the onion
 * skin, the guides and which layers show are local to this person.
 */
export function DrawingEditor({
  store,
  frame,
  label,
  boardAspect,
  readOnly,
  userId = null,
  projectId,
  boardId,
  frames,
  labels,
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
  /** Frames in shooting order: previous and next, the onion skin and the strip of the scene. */
  frames?: readonly FrameElement[];
  labels?: ReadonlyMap<string, string>;
  /** Opens the drawing of another frame. */
  onPick?: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<Tool>(readOnly ? 'pan' : 'pencil');
  const [shapeKind, setShapeKind] = useState<DragShape>('rect');
  const [color, setColor] = useState(PEN_COLORS[0] as string);
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
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [onion, setOnion] = useState(false);
  const [guides, setGuides] = useState(false);
  const [layers, setLayers] = useState(false);
  const [showDrawing, setShowDrawing] = useState(true);
  const [showReference, setShowReference] = useState(true);
  const points = useRef<Point[] | null>(null);
  const shapeStart = useRef<Point | null>(null);
  const panning = useRef<{ x: number; y: number; from: Point } | null>(null);
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
  const scene = frames ? sequence.filter((f) => f.parent === frame.parent) : [];
  const labelOf = (f: FrameElement) => labels?.get(f.id) ?? '';
  const goPrev = prev && onPick ? () => onPick(prev.id) : undefined;
  const goNext = next && onPick ? () => onPick(next.id) : undefined;
  const onionShown = onion && !!prev;

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
    if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;
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
    if (e.key === 'Escape') onClose();
    else if (mod && key === 'z' && !readOnly) e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y' && !readOnly) store.undo.redo();
    else if (!mod && e.key === 'ArrowLeft' && goPrev) goPrev();
    else if (!mod && e.key === 'ArrowRight' && goNext) goNext();
    else if (!mod && (e.key === '+' || e.key === '=')) zoomTo(zoom * ZOOM_STEP);
    else if (!mod && e.key === '-') zoomTo(zoom / ZOOM_STEP);
    else if (!mod && e.key === '0') resetView();
    else if (!mod && key === 'o') setOnion((v) => !v);
    else if (!mod && key === 'g') setGuides((v) => !v);
    else if (!mod && key === 'l') setLayers((v) => !v);
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

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.pen__text')) return;
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

  function onPointerUp() {
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
  const onionLayer = onionShown && prev && (
    <g opacity={0.35}>
      {(prev.strokes ?? []).map((s) => (
        <StrokePath key={s.id} stroke={s} height={height} color={ONION_COLOR} />
      ))}
      {(prev.shapes ?? []).map((s: FrameShape) => (
        <ShapeView key={s.id} shape={s} height={height} color={ONION_COLOR} />
      ))}
    </g>
  );
  const title = t('film.pen.title', { label });
  const percent = Math.round(zoom * 100);

  return (
    <div className="pen" role="dialog" aria-modal="true" aria-label={title}>
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
            <option value="">{t('film.aspect.board', { ratio: aspectLabel(boardAspect) })}</option>
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {aspectLabel(r)}
              </option>
            ))}
          </Select>
        </label>
        <span className="ink-header__spacer" />
        <fieldset className="pen__view" aria-label={t('film.pen.view')}>
          <button
            type="button"
            className="pen__toggle"
            aria-pressed={onionShown}
            disabled={!prev}
            title={`${t('film.pen.onion')} (O)`}
            onClick={() => setOnion((v) => !v)}
          >
            <Icon name="onion" size={16} />
            {prev
              ? t('film.pen.onionOf', { label: labelOf(prev) || t('film.pen.prev') })
              : t('film.pen.onion')}
          </button>
          <button
            type="button"
            className="pen__toggle"
            aria-pressed={guides}
            title={`${t('film.pen.guides')} (G)`}
            onClick={() => setGuides((v) => !v)}
          >
            <Icon name="guides" size={16} />
            {t('film.pen.guides')}
          </button>
          <button
            type="button"
            className="pen__toggle"
            aria-pressed={layers}
            title={`${t('film.pen.layers')} (L)`}
            onClick={() => setLayers((v) => !v)}
          >
            <Icon name="layers" size={16} />
            {t('film.pen.layers')}
          </button>
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
              title={`${t('film.pen.zoomReset', { percent })} (0)`}
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
        <Button variant="primary" onClick={onClose}>
          {t('film.pen.done')}
        </Button>
      </header>
      <div className="pen__main">
        {!readOnly && (
          <div className="pen__tools" role="toolbar" aria-label={title}>
            {TOOLS.map((x) => (
              <button
                key={x.tool}
                type="button"
                className="toolbar__btn"
                aria-pressed={tool === x.tool}
                aria-label={t(`film.pen.${x.tool}`)}
                title={`${t(`film.pen.${x.tool}`)} (${x.key})`}
                onClick={() => setTool(x.tool)}
              >
                <Icon name={x.tool === 'shape' ? SHAPE_ICONS[shapeKind] : x.icon} size={16} />
              </button>
            ))}
            {tool === 'shape' && (
              <>
                <span className="toolbar__sep" aria-hidden="true" />
                {DRAG_SHAPES.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="toolbar__btn"
                    aria-pressed={shapeKind === kind}
                    aria-label={t(`film.pen.shapes.${kind}`)}
                    title={t(`film.pen.shapes.${kind}`)}
                    onClick={() => setShapeKind(kind)}
                  >
                    <Icon name={SHAPE_ICONS[kind]} size={16} />
                  </button>
                ))}
              </>
            )}
            <span className="toolbar__sep" aria-hidden="true" />
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="pen__swatch"
                style={{ background: c }}
                aria-pressed={color === c}
                aria-label={t('film.pen.color', { color: c })}
                onClick={() => {
                  setColor(c);
                  if (tool === 'eraser' || tool === 'pan') setTool('pencil');
                }}
              />
            ))}
            {sized && (
              <label className="pen__width">
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
            <IconButton icon="undo" label={t('film.pen.undo')} onClick={() => store.undo.undo()} />
            <IconButton
              icon="undo"
              className="pen__redo"
              label={t('film.pen.redo')}
              onClick={() => store.undo.redo()}
            />
            <IconButton
              icon="trash"
              label={t('film.pen.clear')}
              disabled={strokes.length === 0 && shapes.length === 0}
              onClick={() => change(() => clearDrawing(store.doc, frame.id, LOCAL))}
            />
          </div>
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
                hideReference={!showReference}
                hideDrawing={!showDrawing}
                pixels={box.w * zoom * (window.devicePixelRatio || 1)}
                under={onionLayer}
              >
                {liveStroke}
                {liveShapeView}
              </FramePicture>
              {guides && (
                <svg
                  className="pen__guides"
                  viewBox={`0 0 ${VIEW_W} ${height}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d={`M${VIEW_W / 3} 0V${height}M${(2 * VIEW_W) / 3} 0V${height}M0 ${height / 3}H${VIEW_W}M0 ${(2 * height) / 3}H${VIEW_W}`}
                  />
                  <rect
                    className="pen__safe"
                    x={VIEW_W * 0.05}
                    y={height * 0.05}
                    width={VIEW_W * 0.9}
                    height={height * 0.9}
                  />
                </svg>
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
          {scene.length > 0 && onPick && (
            <nav className="pen__strip" aria-label={t('film.pen.strip')}>
              <ol>
                {scene.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="pen__strip-item"
                      aria-current={f.id === frame.id ? 'true' : undefined}
                      onClick={() => onPick(f.id)}
                    >
                      <FramePicture
                        assetId={f.assetId}
                        aspect={f.aspect}
                        boardAspect={boardAspect}
                        strokes={f.strokes}
                        shapes={f.shapes}
                        referenceOpacity={f.referenceOpacity}
                        pixels={160}
                      />
                      <span>{labelOf(f)}</span>
                    </button>
                  </li>
                ))}
                {!readOnly && (
                  <li>
                    <button
                      type="button"
                      className="pen__strip-add"
                      onClick={() => {
                        const parent = frame.parent;
                        const sceneId =
                          parent && listElements(store.doc).some((e) => e.id === parent)
                            ? parent
                            : null;
                        const index = sceneId
                          ? childrenOf(listElements(store.doc), sceneId).findIndex(
                              (e) => e.id === frame.id,
                            ) + 1
                          : null;
                        store.undo.stopCapturing();
                        const created = addFrame(
                          store.doc,
                          sceneId,
                          index,
                          {},
                          {
                            userId,
                            origin: LOCAL,
                          },
                        );
                        store.undo.stopCapturing();
                        onPick(created.id);
                      }}
                    >
                      <Icon name="plus" size={16} />
                      {t('film.frame.add')}
                    </button>
                  </li>
                )}
              </ol>
            </nav>
          )}
        </div>
        {layers && (
          <aside className="pen__layers" aria-label={t('film.pen.layers')}>
            <h3>{t('film.pen.layers')}</h3>
            <div className="pen__layer">
              <button
                type="button"
                className="pen__toggle"
                aria-pressed={showDrawing}
                onClick={() => setShowDrawing((v) => !v)}
              >
                <Icon name="pen" size={14} />
                {t('film.pen.layerDrawing')}
              </button>
              <span className="pen__layer-count">
                {t('film.pen.items', { count: strokes.length + shapes.length })}
              </span>
            </div>
            <div className="pen__layer">
              <button
                type="button"
                className="pen__toggle"
                aria-pressed={showReference && !!frame.assetId}
                disabled={!frame.assetId}
                onClick={() => setShowReference((v) => !v)}
              >
                <Icon name="image" size={14} />
                {t('film.pen.layerReference')}
              </button>
              {canUpload && (
                <Button
                  variant="ghost"
                  icon="upload"
                  title={`${t('film.pen.reference')} (I)`}
                  onClick={() => fileInput.current?.click()}
                >
                  {frame.assetId ? t('film.pen.referenceReplace') : t('film.pen.reference')}
                </Button>
              )}
            </div>
            {frame.assetId && (
              <label className="pen__opacity">
                <span>
                  {t('film.pen.opacity', {
                    percent: Math.round((frame.referenceOpacity ?? 1) * 100),
                  })}
                </span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round((frame.referenceOpacity ?? 1) * 100)}
                  disabled={readOnly}
                  onPointerDown={() => store.undo.stopCapturing()}
                  onPointerUp={() => store.undo.stopCapturing()}
                  onChange={(e) => {
                    const value = Number(e.target.value) / 100;
                    updateElement(
                      store.doc,
                      frame.id,
                      { referenceOpacity: value >= 1 ? undefined : value },
                      LOCAL,
                    );
                  }}
                />
              </label>
            )}
          </aside>
        )}
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
            const id = frame.id;
            startUpload({
              file,
              projectId,
              boardId,
              onAsset: (assetId) =>
                updateElement(store.doc, id, { assetId, source: undefined }, LOCAL),
            });
          }}
        />
      )}
    </div>
  );
}
