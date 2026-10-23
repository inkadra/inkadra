import {
  addStroke,
  clearStrokes,
  encodeStroke,
  type FrameElement,
  type Point,
  removeStrokes,
  strokeHit,
} from '@inkadra/canvas-core';
import { type AspectRatio, MAX_STROKES, type Stroke } from '@inkadra/doc-schema';
import { Button, Icon, IconButton, type IconName } from '@inkadra/ui';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { frameRatio } from './aspect.ts';
import { FramePicture } from './FramePicture.tsx';
import { PEN_COLORS, PENS, type PenTool, pathOf, VIEW_W } from './strokes.ts';

const TOOLS: Array<{ tool: PenTool; icon: IconName; key: string }> = [
  { tool: 'pencil', icon: 'pen', key: 'P' },
  { tool: 'brush', icon: 'color', key: 'B' },
  { tool: 'marker', icon: 'heading', key: 'M' },
  { tool: 'eraser', icon: 'eraser', key: 'E' },
];
const ERASER_RADIUS = 0.012;

/**
 * Full-screen editor for the pen drawing of a frame. Each finished line is one stroke in the
 * document, so the drawing syncs line by line and undo goes back one line at a time.
 */
export function DrawingEditor({
  store,
  frame,
  label,
  boardAspect,
  readOnly,
  onClose,
  onPrev,
  onNext,
}: {
  store: BoardStore;
  frame: FrameElement;
  label: string;
  boardAspect: AspectRatio;
  readOnly: boolean;
  onClose: () => void;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<PenTool>('pencil');
  const [color, setColor] = useState(PEN_COLORS[0] as string);
  const [widths, setWidths] = useState<Record<Stroke['tool'], number>>(() => ({
    pencil: PENS.pencil.width,
    brush: PENS.brush.width,
    marker: PENS.marker.width,
  }));
  const [live, setLive] = useState<Point[] | null>(null);
  const points = useRef<Point[] | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ratio = frameRatio(frame.aspect, boardAspect);
  const strokes = frame.strokes ?? [];
  const full = strokes.length >= MAX_STROKES;
  const pen = tool === 'eraser' ? null : tool;

  // The picture fills the stage at the frame's aspect ratio.
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

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    // The canvas behind listens on window too: the editor has the keyboard while open.
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') onClose();
    else if (mod && key === 'z') e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y') store.undo.redo();
    else if (!mod && e.key === 'ArrowLeft' && onPrev) onPrev();
    else if (!mod && e.key === 'ArrowRight' && onNext) onNext();
    else if (!mod) {
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

  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = area.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const erase = (p: Point) => {
    const hit = strokes.filter((s) => strokeHit(s, p, ERASER_RADIUS)).map((s) => s.id);
    if (hit.length > 0) removeStrokes(store.doc, frame.id, hit, LOCAL);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (readOnly || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    store.undo.stopCapturing();
    const p = at(e);
    if (!pen) {
      erase(p);
      points.current = [p];
      return;
    }
    if (full) return;
    points.current = [p];
    setLive([p]);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const current = points.current;
    if (!current) return;
    // Coalesced events keep fast lines smooth on pens and fast mice.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const p = at(ev);
      if (!pen) erase(p);
      else current.push(p);
    }
    if (pen) setLive([...current]);
  }

  function onPointerUp() {
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

  return (
    <div
      className="pen"
      role="dialog"
      aria-modal="true"
      aria-label={t('film.pen.title', { label })}
    >
      <header className="pen__bar">
        <span className="pen__title">{t('film.pen.title', { label })}</span>
        {onPrev && (
          <IconButton
            icon="chevronRight"
            className="pen__prev"
            label={t('film.pen.prev')}
            onClick={onPrev}
          />
        )}
        {onNext && <IconButton icon="chevronRight" label={t('film.pen.next')} onClick={onNext} />}
        <span className="ink-header__spacer" />
        <Button variant="primary" onClick={onClose}>
          {t('film.pen.done')}
        </Button>
      </header>
      <div className="pen__main">
        {!readOnly && (
          <div className="pen__tools" role="toolbar" aria-label={t('film.pen.title', { label })}>
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
                <Icon name={x.icon} size={16} />
              </button>
            ))}
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
                  if (tool === 'eraser') setTool('pencil');
                }}
              />
            ))}
            {pen && (
              <label className="pen__width">
                <span>{t('film.pen.width')}</span>
                <input
                  type="range"
                  min={1}
                  max={pen === 'marker' ? 80 : 40}
                  value={widths[pen]}
                  onChange={(e) => setWidths((w) => ({ ...w, [pen]: Number(e.target.value) }))}
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
              disabled={strokes.length === 0}
              onClick={() => {
                store.undo.stopCapturing();
                clearStrokes(store.doc, frame.id, LOCAL);
                store.undo.stopCapturing();
              }}
            />
          </div>
        )}
        <div className="pen__stage" ref={stage}>
          <div
            ref={area}
            className={`pen__area pen__area--${tool}`}
            style={{ width: box.w, height: box.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <FramePicture
              assetId={frame.assetId}
              aspect={frame.aspect}
              boardAspect={boardAspect}
              strokes={strokes}
              pixels={box.w * (window.devicePixelRatio || 1)}
            >
              {liveStroke}
            </FramePicture>
          </div>
          {full && <p className="pen__full">{t('film.pen.full')}</p>}
        </div>
      </div>
    </div>
  );
}
