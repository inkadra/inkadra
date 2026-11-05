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

/** A handle keeps half of a side clear, so the curves of two corners on that side never meet. */
export function handleRun(side: number, base: number): number {
  if (side >= base * 4) return base;
  // The round caps and the halo take 2.5 px at each end of a curve: 3 px stay clear between two.
  return Math.max(0, Math.min(HANDLE_RUN.small, side / 2 - 4));
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Path of a handle on the top left corner of an outline whose corner sits at the origin, in screen
 * px: `runX` along the top side and `runY` along the left one. When the outline's radius is longer
 * than a run (zoomed in, or a small card), the handle is the part of the arc around the corner's
 * diagonal that reaches as far, and never shorter than at `base`, the radius at 100 %.
 */
export function cornerPath(radius: number, runX: number, runY: number, base = radius): string {
  const arm = (run: number) => {
    if (radius <= run) return { angle: Math.PI / 4, straight: run - radius };
    const byLength = Math.max(0, run - base + (Math.PI * base) / 4) / radius;
    const byReach = Math.PI / 4 - Math.asin(Math.min(1, 1 - run / radius));
    return { angle: Math.min(Math.PI / 4, Math.max(0, byLength, byReach)), straight: 0 };
  };
  const [x, y] = [arm(runX), arm(runY)];
  const at = (a: number): [number, number] => [
    round(radius - radius * Math.cos(a)),
    round(radius - radius * Math.sin(a)),
  ];
  const [x1, y1] = at(Math.PI / 4 - y.angle);
  const [x2, y2] = at(Math.PI / 4 + x.angle);
  const r = round(radius);
  return `M${x1} ${round(y1 + y.straight)}L${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}L${round(x2 + x.straight)} ${y2}`;
}

/** A right angle, for the square frames of the crop stages. */
export const SQUARE_CORNER = cornerPath(0, HANDLE_RUN.desktop, HANDLE_RUN.desktop);

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
  const base = phone ? HANDLE_RUN.phone : HANDLE_RUN.desktop;
  const d = cornerPath(
    CARD_RADIUS * zoom,
    handleRun(rect.w * zoom, base),
    handleRun(rect.h * zoom, base),
    CARD_RADIUS,
  );
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
