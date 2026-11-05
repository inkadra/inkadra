import type { Rect } from '@inkadra/canvas-core';
import { tokens } from '@inkadra/ui';
import { useIsPhone } from '../lib/phone.ts';

/** Controls identify their owner without becoming a second rendered card. */
export function canvasElementId(target: HTMLElement): string | undefined {
  const node = target.closest<HTMLElement>('[data-el], [data-resize-el]');
  return node?.dataset.el ?? node?.dataset.resizeEl;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

const CARD_RADIUS = Number.parseFloat(tokens.radius['radius-md']);
/** Screen px a handle runs along each side from the corner, on a desktop, a phone, a small card. */
export const HANDLE_RUN = { desktop: 15, phone: 19, small: 12 };

/** A handle keeps half of the shorter side clear, so the curves of two corners never meet. */
export function handleRun(shortSide: number, base: number): number {
  if (shortSide >= base * 4) return base;
  // The round caps and the halo take 2.5 px at each end of a curve.
  return Math.max(0, Math.min(HANDLE_RUN.small, shortSide / 2 - 5));
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Path of a handle on the top left corner of an outline whose corner sits at the origin, in screen
 * px. `base` is the outline's radius at 100 %: the path keeps the length it has there (`run` along
 * each side) and, when the board zooms in and the radius grows, it becomes an arc around the
 * corner's diagonal instead of shrinking into the straight sides.
 */
export function cornerPath(radius: number, run: number, base = radius): string {
  const half = Math.max(0, run - base + (Math.PI * base) / 4);
  const angle = radius > 0 ? Math.min(Math.PI / 4, half / radius) : Math.PI / 4;
  const straight = Math.max(0, half - (Math.PI * radius) / 4);
  const at = (a: number) => round(radius - radius * Math.cos(a));
  const a = Math.PI / 4 - angle;
  const [x1, y1] = [at(a), at(Math.PI / 2 - a)];
  const [x2, y2] = [y1, x1];
  return `M${x1} ${round(y1 + straight)}L${x1} ${y1}A${round(radius)} ${round(radius)} 0 0 1 ${x2} ${y2}L${round(x2 + straight)} ${y2}`;
}

/** A right angle, for the square frames of the crop stages. */
export const SQUARE_CORNER = cornerPath(0, HANDLE_RUN.desktop);

/** The visible part of a corner handle; the parent sets `--curve-at`, its distance from the corner. */
export function HandleCurve({ corner, d }: { corner: Corner; d: string }) {
  return (
    <svg
      className={`handle-curve handle-curve--${corner}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path className="handle-curve__halo" d={d} />
      <path className="handle-curve__line" d={d} />
    </svg>
  );
}

export function ResizeHandles({
  id,
  rect,
  zoom,
  resizing = false,
}: {
  id: string;
  rect: Rect;
  zoom: number;
  resizing?: boolean;
}) {
  const phone = useIsPhone();
  const run = handleRun(
    Math.min(rect.w, rect.h) * zoom,
    phone ? HANDLE_RUN.phone : HANDLE_RUN.desktop,
  );
  const d = cornerPath(CARD_RADIUS * zoom, run, CARD_RADIUS);
  return (
    <div
      className={`canvas__resize-handles${resizing ? ' is-resizing' : ''}`}
      data-resize-el={id}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        ['--zoom' as string]: zoom,
      }}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <span
          key={corner}
          className={`card__handle card__handle--${corner}`}
          data-handle={corner}
          aria-hidden="true"
        >
          <HandleCurve corner={corner} d={d} />
        </span>
      ))}
    </div>
  );
}
