import { Icon, KeyCap } from '@inkadra/ui';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../lib/phone.ts';
import { TourMedia } from './media.tsx';
import { stepKeys, type Tour, type TourStep } from './tours.ts';

/** The element a step points at: the first one with this `data-tour` that is on screen. */
export function findAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    // A fading copy left by an exit animation is not the real thing.
    if (el.closest('.ink-motion-exit, [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    return el;
  }
  return null;
}

type Shown = { step: TourStep; index: number };

/**
 * The steps to play: those whose anchor is on screen, and the card-only ones. A tour with none
 * of its anchors here (a replay from Settings, far from the feature) plays every step as a card:
 * never a blank screen.
 */
export function playable(steps: TourStep[], present: (anchor: string) => boolean): Shown[] {
  const all = steps.map((step, index) => ({ step, index }));
  const here = all.filter(({ step }) => step.anchor === null || present(step.anchor));
  if (here.some(({ step }) => step.anchor !== null)) return here;
  return all.map(({ step, index }) => ({ step: { ...step, anchor: null }, index }));
}

const WAIT_MS = 2500;
const PAD = 6;
const MARGIN = 16;
const GAP = 18;

type Rect = { x: number; y: number; w: number; h: number };

/** The coach card's corner for a target, as in the approved mockup: beside it, else centred. */
function placeCoach(
  r: Rect | null,
  side: TourStep['side'],
  card: { w: number; h: number },
  view: { w: number; h: number },
  phone: boolean,
) {
  let x: number;
  let y: number;
  if (!r) {
    x = (view.w - card.w) / 2;
    y = (view.h - card.h) / 2;
  } else if (phone) {
    x = MARGIN;
    y = r.y + r.h / 2 < view.h / 2 ? r.y + r.h + PAD + GAP : r.y - PAD - GAP - card.h;
  } else if (side === 'right') {
    x = r.x + r.w + PAD + GAP;
    y = r.y - 8;
  } else if (side === 'left') {
    x = r.x - PAD - GAP - card.w;
    y = r.y - 8;
  } else if (side === 'bottom') {
    x = r.x + r.w / 2 - card.w / 2;
    y = r.y + r.h + PAD + GAP;
  } else {
    x = r.x + r.w / 2 - card.w / 2;
    y = r.y - PAD - GAP - card.h;
  }
  return {
    x: Math.max(MARGIN, Math.min(view.w - card.w - MARGIN, x)),
    y: Math.max(MARGIN, Math.min(view.h - card.h - MARGIN, y)),
  };
}

/**
 * Plays a tour: a scrim with a cut-out over the step's element and a coach card that glides
 * beside it (#502). A modal dialog, so focus stays in it and the browser gives it back on close.
 * `onEnd(true)` after the last step, `onEnd(false)` when skipped.
 */
export function TourPlayer({
  tour,
  settle,
  onEnd,
}: {
  tour: Pick<Tour, 'id' | 'steps'>;
  /** Anchors to wait for first, in turn, after the tour opened another page. */
  settle?: string[];
  onEnd: (finished: boolean) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [shown, setShown] = useState<Shown[] | null>(null);
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [coach, setCoach] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const lastSpot = useRef<Rect | null>(null);
  const ended = useRef(false);

  // Wait for the page to show at least one anchor (a board still loading), or the anchors of
  // `settle` one after the other (the dock, then the cards), then fix the steps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once, when the tour starts.
  useEffect(() => {
    const anchored = tour.steps.filter((s) => s.anchor);
    const waits = [...(settle ?? [])];
    let started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const late = Date.now() - started > WAIT_MS;
      const first = waits[0];
      if (first !== undefined) {
        if (findAnchor(first) || late) {
          waits.shift();
          started = Date.now();
        }
        timer = setTimeout(check, 150);
        return;
      }
      const ready = anchored.some((s) => s.anchor && findAnchor(s.anchor));
      if (ready || anchored.length === 0 || late)
        setShown(playable(tour.steps, (a) => !!findAnchor(a)));
      else timer = setTimeout(check, 150);
    };
    check();
    return () => clearTimeout(timer);
  }, [tour]);

  const current = shown?.[at];
  const anchor = current?.step.anchor ?? null;

  const end = useCallback(
    (finished: boolean) => {
      if (ended.current) return;
      ended.current = true;
      // Closing first lets the browser give the focus back to where it was.
      dialog.current?.close();
      onEnd(finished);
    },
    [onEnd],
  );

  useEffect(() => {
    const el = dialog.current;
    if (shown && el && !el.open) el.showModal();
  }, [shown]);

  // Follow the element: it scrolls into view, and the spot keeps up with resizes and scrolling.
  useEffect(() => {
    if (!shown) return;
    const target = anchor ? findAnchor(anchor) : null;
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const measure = () => {
      const el = anchor ? (target?.isConnected ? target : findAnchor(anchor)) : null;
      const r = el?.getBoundingClientRect();
      setRect(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      removeEventListener('resize', measure);
      removeEventListener('scroll', measure, true);
    };
  }, [shown, anchor]);

  // The card goes beside the spot once its size is known; it glides there (CSS transition).
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !current) return;
    setCoach(
      placeCoach(
        rect && { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 },
        current.step.side,
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: innerWidth, h: innerHeight },
        phone,
      ),
    );
  }, [rect, current, phone]);

  // The spot moves with a transform only (FLIP): it takes its new size at once and starts
  // scaled to the old one, then glides to the new place.
  useLayoutEffect(() => {
    const el = spot.current;
    if (!el || !rect) {
      lastSpot.current = null;
      return;
    }
    const to = { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 };
    const from = lastSpot.current;
    lastSpot.current = to;
    el.style.width = `${to.w}px`;
    el.style.height = `${to.h}px`;
    if (from && (from.x !== to.x || from.y !== to.y || from.w !== to.w || from.h !== to.h)) {
      el.style.transition = 'none';
      el.style.transform = `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;
      el.getBoundingClientRect();
      el.style.transition = '';
    }
    el.style.transform = `translate(${to.x}px, ${to.y}px)`;
  }, [rect]);

  // Next has the focus on every step, once the card is placed (a hidden card takes no focus).
  const placed = coach !== null;
  useEffect(() => {
    if (current && placed) next.current?.focus({ preventScroll: true });
  }, [current, placed]);

  if (!shown || !current) return null;
  const last = at === shown.length - 1;
  const go = (by: number) => {
    const to = at + by;
    if (to < 0) return;
    if (to >= shown.length) end(true);
    else setAt(to);
  };
  const keys = stepKeys(tour.id, current.index);
  return (
    <dialog
      ref={dialog}
      className={`tour${rect ? '' : ' tour--plain'}`}
      // What the spotlight is on, for the end-to-end tests.
      data-anchor={rect ? (anchor ?? undefined) : undefined}
      aria-labelledby="tour-title"
      aria-describedby="tour-text"
      onCancel={(e) => {
        e.preventDefault();
        end(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) go(1);
        else return;
        e.preventDefault();
      }}
    >
      {rect && <div ref={spot} className="tour__spot" aria-hidden="true" />}
      <div
        ref={card}
        className="tour__coach"
        style={
          {
            transform: coach ? `translate(${coach.x}px, ${coach.y}px)` : undefined,
            visibility: coach ? undefined : 'hidden',
          } as CSSProperties
        }
      >
        <button type="button" className="tour__skip" onClick={() => end(false)}>
          {t('tutorial.coach.skip')}
          {!phone && <span className="tour__skip-key">Esc</span>}
        </button>
        <TourMedia id={current.step.media} />
        <div key={at} className="tour__body">
          <h3 id="tour-title">{t(keys.title)}</h3>
          <p id="tour-text">{t(keys.text)}</p>
          {current.step.keys && !phone && (
            <p className="tour__keys">
              {t('tutorial.coach.shortcut')}
              {current.step.keys.map((k) => (
                <KeyCap key={k}>{k}</KeyCap>
              ))}
            </p>
          )}
        </div>
        <div className="tour__foot">
          <span className="tour__dots" aria-hidden="true">
            {shown.map(({ index }, i) => (
              <i key={index} className={i === at ? 'is-on' : i < at ? 'is-past' : undefined} />
            ))}
          </span>
          <span className="tour__count">
            {t('tutorial.coach.count', { index: at + 1, total: shown.length })}
          </span>
          <span className="tour__nav">
            <button
              type="button"
              className="tour__back"
              aria-label={t('tutorial.coach.back')}
              disabled={at === 0}
              onClick={() => go(-1)}
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <button
              ref={next}
              type="button"
              className="ink-btn ink-btn--primary tour__next"
              onClick={() => go(1)}
            >
              {t(last ? 'tutorial.coach.done' : 'tutorial.coach.next')}
              <Icon name={last ? 'check' : 'chevronRight'} size={13} />
            </button>
          </span>
        </div>
      </div>
    </dialog>
  );
}
