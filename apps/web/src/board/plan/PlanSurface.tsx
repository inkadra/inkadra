// SPDX-License-Identifier: AGPL-3.0-only
import {
  fitPlanView,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanArea,
  type PlanInsets,
  type Point,
  panPlanBy,
  pinchPlanView,
  planZoomPercent,
  type Rect,
  stepPlanZoom,
  type Viewport,
  zoomPlanAround,
} from '@inkadra/canvas-core';
import { IconButton } from '@inkadra/ui';
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { wheelZoomFactor } from '../wheel-zoom.ts';

/** Smallest gap between two dots of the grid on screen, px: closer ones are skipped. */
const MIN_DOT_GAP = 7;
/** A pointer that moves less than this (px) while panning has clicked. */
const CLICK_SLOP = 4;
/** Px a line of a wheel in line mode scrolls. */
const LINE = 16;

interface Pinch {
  ids: [number, number];
  from: [Point, Point];
  view: Viewport;
}

/**
 * The drawing surface of a set plan (decision 0118), shared by the editor and the read-only
 * view: it fills its area with the dot grid, and the plan's 3:2 extent (the stage) lies in it,
 * panned and zoomed with the board's maths (canvas-core `zoomAt`, `pinchViewport`, the wheel's
 * `wheelZoomFactor`): a drag on empty space, the middle button or Space pans, the wheel and a
 * trackpad pinch zoom round the pointer (a sideways swipe pans), two fingers pan and zoom, the
 * zoom control steps round the middle and Fit frames what is on the plan. Panning writes the stage's transform at once, without a
 * render, so a plan of 300 icons pans at the screen's rate; a change of zoom renders once a frame.
 */
export function usePlanSurface({
  content,
  insets,
  grid,
  fitWidth = false,
}: {
  /** What Fit frames, in view units; null for the whole extent. */
  content: Rect | null;
  /** Bars floating over the surface, which Fit leaves free. */
  insets: PlanInsets;
  /** Spacing of the dots, in view units; none without. */
  grid?: number | undefined;
  /** Fit fills the width and lets the height run over (a phone, as the mockup shows a room). */
  fitWidth?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const area = useRef<PlanArea>({ w: 0, h: 0 });
  const viewRef = useRef<Viewport | null>(null);
  const [view, setViewState] = useState<Viewport | null>(null);
  const frame = useRef<number | undefined>(undefined);
  /** The person moved the view: a resize keeps it instead of fitting again. */
  const touched = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const pan = useRef<{ last: Point; moved: number } | null>(null);
  const gridRef = useRef(grid);
  const fitArgs = useRef({ content, insets, fitWidth });
  fitArgs.current = { content, insets, fitWidth };

  /** Writes the view to the stage and the grid, and renders on the next frame. */
  const apply = useCallback((v: Viewport, render = true) => {
    viewRef.current = v;
    const s = stage.current;
    if (s) {
      s.style.width = `${PLAN_VIEW_W * v.zoom}px`;
      s.style.height = `${PLAN_VIEW_H * v.zoom}px`;
      s.style.transform = `translate(${-v.x * v.zoom}px, ${-v.y * v.zoom}px)`;
    }
    const el = surface.current;
    const step = gridRef.current;
    if (el) {
      if (step) {
        let gap = step * v.zoom;
        while (gap < MIN_DOT_GAP) gap *= 2;
        el.style.backgroundSize = `${gap}px ${gap}px`;
        el.style.backgroundPosition = `${-v.x * v.zoom - gap / 2}px ${-v.y * v.zoom - gap / 2}px`;
      } else el.style.backgroundSize = '0 0';
    }
    if (!render) return;
    if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setViewState(viewRef.current);
      });
  }, []);

  const fit = useCallback(() => {
    if (!area.current.w) return;
    const { content: box, insets: free, fitWidth: byWidth } = fitArgs.current;
    apply(fitPlanView(box, area.current, free, byWidth));
  }, [apply]);

  // The area's size: the first one fits the plan's content, later ones keep the view.
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const widthChanged = r.width !== area.current.w;
      area.current = { w: r.width, h: r.height };
      const v = viewRef.current;
      // A sheet opening under the plan changes only the height: the view stays.
      if (!v || (!touched.current && widthChanged)) fit();
      else apply(panPlanBy(v, area.current, 0, 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [apply, fit]);
  // The grid follows the scale and the grid chosen.
  useLayoutEffect(() => {
    gridRef.current = grid;
    if (viewRef.current) apply(viewRef.current, false);
  }, [grid, apply]);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = surface.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  const move = (next: (v: Viewport) => Viewport) => {
    const v = viewRef.current;
    if (!v || !area.current.w) return;
    touched.current = true;
    apply(next(v));
  };

  // Wheel: zooms round the pointer, a notch a step as on the board, a trackpad pinch directly;
  // Shift + wheel and a sideways swipe pan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs only; bound once.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? LINE : 1;
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.shiftKey || (sideways && !e.ctrlKey && !e.metaKey)) {
        const dx = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * unit;
        move((v) => panPlanBy(v, area.current, -dx, 0));
        return;
      }
      const at = local(e);
      const { factor } = wheelZoomFactor(e.deltaY, e.deltaMode);
      move((v) => zoomPlanAround(v, area.current, v.zoom * factor, at));
    };
    // Older Safari zooms the page on a pinch even where touch-action is none.
    const noPageZoom = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', noPageZoom);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', noPageZoom);
    };
  }, []);

  const pinchPoints = (ids: [number, number]): [Point, Point] | null => {
    const a = pointers.current.get(ids[0]);
    const b = pointers.current.get(ids[1]);
    return a && b ? [a, b] : null;
  };

  return {
    surface,
    stage,
    view,
    /** The zoom as the control shows it. */
    percent: view && area.current.w ? planZoomPercent(view, area.current) : 100,
    /** A view unit on screen, px. */
    unit: view?.zoom ?? 0,
    fit: () => {
      touched.current = true;
      fit();
    },
    zoomBy: (dir: 1 | -1) => move((v) => stepPlanZoom(v, area.current, dir)),
    panBy: (dx: number, dy: number) => move((v) => panPlanBy(v, area.current, dx, dy)),
    /**
     * A pointer pressed on the surface. A second finger starts a pinch: true, and the caller
     * drops what the first finger started.
     */
    down: (e: PointerEvent<HTMLElement>): boolean => {
      if (e.pointerType !== 'touch') return false;
      pointers.current.set(e.pointerId, local(e));
      if (pointers.current.size !== 2 || !viewRef.current) return pinch.current !== null;
      const ids = [...pointers.current.keys()] as [number, number];
      const from = pinchPoints(ids);
      if (!from) return false;
      pan.current = null;
      pinch.current = { ids, from, view: viewRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
      return true;
    },
    /** Starts panning with this pointer (a drag on empty space, the middle button, Space). */
    startPan: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = { last: local(e), moved: 0 };
    },
    /** Px the pan of this press has moved so far; 0 when there is none. */
    panMoved: () => pan.current?.moved ?? 0,
    /** Ends a pan without a click (a long press that turned into a selection box). */
    stopPan: () => {
      pan.current = null;
    },
    /** A pointer moved: true when the surface took it (a pan or a pinch). */
    moveTo: (e: PointerEvent<HTMLElement>): boolean => {
      const at = local(e);
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, at);
      const p = pinch.current;
      if (p) {
        const to = pinchPoints(p.ids);
        if (to) {
          touched.current = true;
          apply(pinchPlanView(p.view, area.current, p.from, to));
        }
        return true;
      }
      const g = pan.current;
      if (!g) return false;
      const dx = at.x - g.last.x;
      const dy = at.y - g.last.y;
      g.last = at;
      g.moved += Math.abs(dx) + Math.abs(dy);
      move((v) => panPlanBy(v, area.current, dx, dy));
      return true;
    },
    /**
     * A pointer let go or taken away: whether it ended a pan that never moved (a click on empty
     * space) or anything the surface was doing; null when the surface had nothing going on.
     */
    up: (e: PointerEvent<HTMLElement>): 'click' | 'done' | null => {
      pointers.current.delete(e.pointerId);
      if (pinch.current) {
        // The finger left after a pinch starts nothing until all are up.
        if (pointers.current.size === 0) pinch.current = null;
        return 'done';
      }
      const g = pan.current;
      if (!g) return null;
      pan.current = null;
      return g.moved < CLICK_SLOP ? 'click' : 'done';
    },
  };
}

export type PlanSurface = ReturnType<typeof usePlanSurface>;

/** The zoom control of a plan's surface: out, the percent, in, fit. */
export function ZoomControl({
  surface,
  className = '',
}: {
  surface: PlanSurface;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      className={`plan-float plan-canvas__zoom ${className}`}
      aria-label={t('board.plan.zoom')}
    >
      <IconButton
        icon="minus"
        label={t('board.plan.zoomOut')}
        disabled={surface.percent <= 25}
        onClick={() => surface.zoomBy(-1)}
      />
      <span className="plan-canvas__percent" aria-live="polite">
        {surface.percent}%
      </span>
      <IconButton
        icon="plus"
        label={t('board.plan.zoomIn')}
        disabled={surface.percent >= 800}
        onClick={() => surface.zoomBy(1)}
      />
      <IconButton icon="fit" label={t('board.plan.zoomFit')} onClick={surface.fit} />
    </fieldset>
  );
}
