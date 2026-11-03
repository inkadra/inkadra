// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** One image's local view; changing images remounts it at fit. */
export function ViewerImage({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const pressed = useRef<EventTarget | null>(null);
  const zoom = useCallback(
    (factor: number) =>
      setView((v) => {
        const next = Math.max(1, Math.min(8, v.zoom * factor));
        return { zoom: next, x: next === 1 ? 0 : v.x, y: next === 1 ? 0 : v.y };
      }),
    [],
  );
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoom]);
  return (
    <div
      ref={host}
      role="application"
      aria-label={t('viewer.zoom')}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: image canvas supports keyboard zoom and panning.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === '+' || e.key === '=') zoom(1.5);
        else if (e.key === '-') zoom(1 / 1.5);
        else if (e.key === '0') setView({ zoom: 1, x: 0, y: 0 });
        else if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          view.zoom > 1
        ) {
          e.preventDefault();
          e.stopPropagation();
          setView((v) => ({
            ...v,
            x: v.x + (e.key === 'ArrowLeft' ? 32 : e.key === 'ArrowRight' ? -32 : 0),
            y: v.y + (e.key === 'ArrowUp' ? 32 : e.key === 'ArrowDown' ? -32 : 0),
          }));
        }
      }}
      className="viewer__image-view"
      data-scroll
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        zoom(view.zoom === 1 ? 2 : 1 / view.zoom);
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        pressed.current = e.target;
        dragged.current = false;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (view.zoom > 1 || points.current.size > 1)
          e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const previous = points.current.get(e.pointerId);
        if (!previous) return;
        const other = [...points.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
        const next = { x: e.clientX, y: e.clientY };
        const dx = next.x - previous.x;
        const dy = next.y - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragged.current = true;
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y);
          const after = Math.hypot(next.x - other.x, next.y - other.y);
          if (before > 0) zoom(after / before);
        } else if (view.zoom > 1) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        points.current.set(e.pointerId, next);
      }}
      onPointerUp={(e) => {
        points.current.delete(e.pointerId);
      }}
      onPointerCancel={() => {
        points.current.clear();
        dragged.current = true;
      }}
      onClick={(e) => {
        // Pointer capture retargets a click on the zoomed image to this canvas.
        const target = (pressed.current ?? e.target) as HTMLElement;
        pressed.current = null;
        if (!dragged.current && !target.closest('img, .cropped-image, button')) onClose();
      }}
    >
      <div
        className="viewer__image-plane"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {children}
      </div>
      <fieldset className="viewer__image-tools" aria-label={t('viewer.zoom')}>
        <Button
          aria-label={t('viewer.zoomOut')}
          disabled={view.zoom === 1}
          onClick={() => zoom(1 / 1.5)}
        >
          −
        </Button>
        <Button onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          {Math.round(view.zoom * 100)}%
        </Button>
        <Button
          aria-label={t('viewer.zoomIn')}
          disabled={view.zoom === 8}
          onClick={() => zoom(1.5)}
        >
          +
        </Button>
      </fieldset>
    </div>
  );
}
