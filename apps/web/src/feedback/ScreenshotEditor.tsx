import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../lib/phone.ts';

type Box = { id: string; x: number; y: number; w: number; h: number; tool: 'draw' | 'redact' };
export function ScreenshotEditor({
  source,
  initialTool,
  onSave,
  onClose,
}: {
  source: Blob;
  initialTool: Box['tool'];
  /** The flattened picture and how many new areas it covers. */
  onSave: (blob: Blob, redactedAreas: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, select] = useState<string | null>(null);
  const [tool, setTool] = useState<Box['tool']>(initialTool);
  // A new or resized area spans from this fixed corner to the pointer.
  const drag = useRef<{
    x: number;
    y: number;
    original: Box;
    mode: 'span' | 'move';
  } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      image.current = img;
      setReady(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [source]);
  function paint() {
    const el = canvas.current;
    const img = image.current;
    if (!el || !img) return;
    el.width = img.width;
    el.height = img.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const tokens = getComputedStyle(document.documentElement);
    for (const box of boxes) {
      if (box.tool === 'draw') {
        ctx.strokeStyle = tokens.getPropertyValue('--ink-status-danger').trim();
        ctx.lineWidth = Math.max(3, img.width / 320);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      } else {
        // Opaque mosaic independent of source pixels: hidden text cannot be reconstructed.
        const cell = Math.max(8, img.width / 64);
        for (let x = 0; x < box.w; x += cell)
          for (let y = 0; y < box.h; y += cell) {
            ctx.fillStyle = tokens
              .getPropertyValue(
                (Math.round(x / cell) + Math.round(y / cell)) % 2
                  ? '--ink-surface-3'
                  : '--ink-text-muted',
              )
              .trim();
            ctx.fillRect(
              box.x + x,
              box.y + y,
              Math.min(cell, box.w - x),
              Math.min(cell, box.h - y),
            );
          }
      }
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: image load also requires repaint
  useEffect(paint, [boxes, ready]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget,
      r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(el.width, ((e.clientX - r.left) * el.width) / r.width)),
      y: Math.max(0, Math.min(el.height, ((e.clientY - r.top) * el.height) / r.height)),
    };
  };
  function addArea() {
    const el = canvas.current;
    if (!el) return;
    const box = {
      id: crypto.randomUUID(),
      x: el.width / 4,
      y: el.height / 4,
      w: el.width / 3,
      h: el.height / 4,
      tool,
    };
    setBoxes([...boxes, box]);
    select(box.id);
  }
  const selection = boxes.find((box) => box.id === selected);
  return (
    <Dialog open title={t('feedback.editScreenshot')} onClose={onClose}>
      <div className="feedback-editor">
        <div className="feedback-editor__tools" role="toolbar" aria-label={t('feedback.tools')}>
          <Button icon="eyeOff" aria-pressed={tool === 'redact'} onClick={() => setTool('redact')}>
            {t('feedback.blur')}
          </Button>
          <Button icon="rect" aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}>
            {t('feedback.draw')}
          </Button>
          <span className="feedback-editor__sep" aria-hidden="true" />
          <Button
            variant="ghost"
            icon="undo"
            disabled={!boxes.length}
            onClick={() => {
              setBoxes(boxes.slice(0, -1));
              select(null);
            }}
          >
            {t('feedback.undo')}
          </Button>
          <Button
            variant="ghost"
            icon="trash"
            disabled={!selection}
            onClick={() => {
              setBoxes(boxes.filter((box) => box.id !== selected));
              select(null);
            }}
          >
            {t('feedback.removeArea')}
          </Button>
        </div>
        <div className="feedback-editor-surface">
          <canvas
            tabIndex={0}
            ref={canvas}
            aria-label={t('feedback.editScreenshot')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addArea();
                return;
              }
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                setBoxes(boxes.filter((box) => box.id !== selected));
                select(null);
                return;
              }
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const axis =
                e.key === 'ArrowLeft' || e.key === 'ArrowRight'
                  ? e.shiftKey
                    ? 'w'
                    : 'x'
                  : e.shiftKey
                    ? 'h'
                    : 'y';
              const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -5 : 5;
              setBoxes(
                boxes.map((box) =>
                  box.id === selected
                    ? {
                        ...box,
                        [axis]: Math.max(
                          0,
                          Math.min(
                            (axis === 'x' || axis === 'w'
                              ? canvas.current?.width
                              : canvas.current?.height) ?? 0,
                            box[axis] + delta,
                          ),
                        ),
                      }
                    : box,
                ),
              );
            }}
            onPointerDown={(e) => {
              const p = point(e);
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              const hit = [...boxes]
                .reverse()
                .find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
              const tolerance =
                (14 * e.currentTarget.width) / e.currentTarget.getBoundingClientRect().width;
              const near = (a: number, b: number) => Math.abs(a - b) < tolerance;
              const resized = [...boxes]
                .reverse()
                .find(
                  (b) =>
                    (near(p.x, b.x) || near(p.x, b.x + b.w)) &&
                    (near(p.y, b.y) || near(p.y, b.y + b.h)),
                );
              if (resized) {
                select(resized.id);
                drag.current = {
                  x: near(p.x, resized.x) ? resized.x + resized.w : resized.x,
                  y: near(p.y, resized.y) ? resized.y + resized.h : resized.y,
                  original: resized,
                  mode: 'span',
                };
              } else if (hit) {
                select(hit.id);
                drag.current = { ...p, original: hit, mode: 'move' };
              } else {
                const box = { id: crypto.randomUUID(), ...p, w: 0, h: 0, tool };
                setBoxes([...boxes, box]);
                select(box.id);
                drag.current = { ...p, original: box, mode: 'span' };
              }
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const p = point(e);
              setBoxes((old) =>
                old.map((box) =>
                  box.id !== d.original.id
                    ? box
                    : d.mode === 'span'
                      ? {
                          ...box,
                          x: Math.min(d.x, p.x),
                          y: Math.min(d.y, p.y),
                          w: Math.abs(p.x - d.x),
                          h: Math.abs(p.y - d.y),
                        }
                      : {
                          ...box,
                          x: Math.max(
                            0,
                            Math.min(e.currentTarget.width - box.w, d.original.x + p.x - d.x),
                          ),
                          y: Math.max(
                            0,
                            Math.min(e.currentTarget.height - box.h, d.original.y + p.y - d.y),
                          ),
                        },
                ),
              );
            }}
            onPointerUp={() => {
              drag.current = null;
              setBoxes((old) => old.filter((box) => box.w >= 2 && box.h >= 2));
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
          {selection && image.current && (
            <div
              className="feedback-editor-selection"
              aria-hidden="true"
              style={{
                left: `${(selection.x / image.current.width) * 100}%`,
                top: `${(selection.y / image.current.height) * 100}%`,
                width: `${(selection.w / image.current.width) * 100}%`,
                height: `${(selection.h / image.current.height) * 100}%`,
              }}
            >
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <p className="feedback-editor__hint">
          {t(phone ? 'feedback.editorHelpPhone' : 'feedback.editorHelp')}{' '}
          {t('feedback.editorMerged')}
        </p>
      </div>
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          {t('feedback.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => {
            paint();
            canvas.current?.toBlob((blob) => {
              if (blob) onSave(blob, boxes.filter((box) => box.tool === 'redact').length);
            }, 'image/png');
          }}
        >
          {t('feedback.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
