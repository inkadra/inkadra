import type { Rect } from '@inkadra/canvas-core';

/** Controls identify their owner without becoming a second rendered card. */
export function canvasElementId(target: HTMLElement): string | undefined {
  const node = target.closest<HTMLElement>('[data-el], [data-resize-el]');
  return node?.dataset.el ?? node?.dataset.resizeEl;
}

export function ResizeHandles({ id, rect, zoom }: { id: string; rect: Rect; zoom: number }) {
  return (
    <div
      className="canvas__resize-handles"
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
        />
      ))}
    </div>
  );
}
