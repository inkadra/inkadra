import { type ReactNode, useRef, useState } from 'react';
import { SLOP_PX, settle, startsSwipe, swipeOffset } from './swipe.ts';

export interface SwipeAction {
  label: string;
  tone: 'neutral' | 'positive';
  onClick: () => void;
}

/**
 * A list row that a finger swipes left to show its actions (#110, phones). The actions are the
 * row's own, also reachable without swiping; while closed they are inert, so the keyboard and
 * screen readers meet them only where they always are.
 */
export function SwipeRow({
  className,
  actions,
  children,
}: {
  className: string;
  actions: readonly SwipeAction[];
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; base: number; swiping: boolean } | null>(null);
  const moved = useRef(false);
  const width = () => drawer.current?.offsetWidth ?? 0;
  const open = offset !== 0;
  return (
    <li className={`${className} swipe-row`}>
      <div ref={drawer} className="swipe-row__actions" inert={!open}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`swipe-row__action swipe-row__action--${action.tone}`}
            onClick={() => {
              setOffset(0);
              action.onClick();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        className={`swipe-row__front${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          moved.current = false;
          if (e.pointerType !== 'touch' || !startsSwipe(e.clientX)) return;
          gesture.current = { x: e.clientX, y: e.clientY, base: offset, swiping: false };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.swiping) {
            if (Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) {
              gesture.current = null; // a scroll of the list
              return;
            }
            if (Math.abs(dx) <= SLOP_PX) return;
            g.swiping = true;
            moved.current = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setOffset(swipeOffset(g.base, dx, width()));
        }}
        onPointerUp={() => {
          if (gesture.current?.swiping) setOffset((o) => settle(o, width()));
          gesture.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragging(false);
          setOffset((o) => settle(o, width()));
        }}
        onClickCapture={(e) => {
          // The click that ends a swipe, or a tap on an open row, only closes it.
          if (moved.current || open) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </li>
  );
}
