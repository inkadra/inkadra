import { Icon } from '@inkadra/ui';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * Where a pill or a toast goes: inside the topmost modal dialog when one is open (Share,
 * Versions, Settings), since everything outside it is inert, else the page.
 */
function topLayer(): Element {
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => {
    try {
      return d.matches(':modal') && !d.classList.contains('tour');
    } catch {
      return false;
    }
  });
  return open.at(-1) ?? document.body;
}

function InTopLayer({ children }: { children: ReactNode }) {
  const [host] = useState(topLayer);
  return createPortal(children, host);
}

/**
 * What stays at the bottom of a screen: the board's dock and zoom corner, the set plan's and
 * Draw's tools, the presentation's strip, a dialog's buttons, the comment box, the phone's tabs.
 */
const BOTTOM_CHROME = [
  '[data-tour="dock"]',
  '.canvas__corner',
  '[data-tour="plan-tools"]',
  '.pen__tools',
  '.pen__view',
  '.present-bottom',
  '.ink-dialog__actions',
  '[data-tour="comments-composer"]',
  '.mobile-bottom-nav',
].join(', ');
const ABOVE = 12;

type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'width' | 'height'> & { bottom: number };

/**
 * The bottom offset that keeps a floating message clear of the bottom chrome it would cover,
 * stacked pieces included, so a pill or a toast never hides a view's controls (the top is where
 * the views keep theirs). 0: it covers nothing where it is.
 */
export function aboveChrome(box: Box, chrome: Box[], viewHeight: number): number {
  let lift = 0;
  const below = chrome
    .filter((r) => r.width > 0 && r.height > 0 && r.top > viewHeight / 2)
    .filter((r) => r.left < box.right && r.right > box.left)
    .sort((a, b) => b.top - a.top);
  for (const r of below) {
    if (r.top < box.bottom - lift && r.bottom > box.top - lift) lift = box.bottom - r.top + ABOVE;
  }
  return lift ? viewHeight - (box.bottom - lift) : 0;
}

/** Lifts the element above the bottom chrome, now and when the window changes size. */
export function useAboveChrome(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      el.style.bottom = '';
      // Only chrome that is in front: not under a sheet or behind a modal dialog.
      el.style.pointerEvents = 'none';
      const chrome = [...document.querySelectorAll(BOTTOM_CHROME)]
        .map((c) => ({ c, r: c.getBoundingClientRect() }))
        .filter(({ c, r }) =>
          c.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        )
        .map(({ r }) => r);
      el.style.pointerEvents = '';
      // The height from the offsets: the entrance animation moves it up and down.
      const { left, right, width } = el.getBoundingClientRect();
      const { offsetTop: top, offsetHeight: height } = el;
      const box = { left, right, width, top, height, bottom: top + height };
      const lift = aboveChrome(box, chrome, innerHeight);
      if (lift) el.style.bottom = `${lift}px`;
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [ref]);
}

/** "First time in Storyboard?": offers a tour, dismissed with ×. */
export function TourPill({
  text,
  action,
  onGo,
  onDismiss,
}: {
  text: string;
  action: string;
  onGo: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useAboveChrome(ref);
  return (
    <InTopLayer>
      <div ref={ref} className="tour-pill" role="status" data-tutorial>
        <span className="tour-pill__spark" aria-hidden="true">
          <Icon name="star" size={14} />
        </span>
        <span className="tour-pill__text">{text}</span>
        <button type="button" className="ink-btn ink-btn--primary tour-pill__go" onClick={onGo}>
          {action}
        </button>
        <button
          type="button"
          className="ink-iconbtn tour-pill__close"
          aria-label={t('tutorial.pill.later')}
          data-ink-tooltip={t('tutorial.pill.later')}
          onClick={onDismiss}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </InTopLayer>
  );
}

export type ToastMessage = { id: number; text: string; ok?: boolean; onOpen?: () => void };

const TOAST_MS = 6000;

/** Says where a skipped tour is now; "Open" goes there. */
export function TourToast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useAboveChrome(ref);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, onClose]);
  return (
    <InTopLayer>
      <div
        ref={ref}
        className="tour-toast"
        data-tutorial
        role="status"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        {toast.ok && (
          <span className="tour-toast__ok" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
        )}
        <span>{toast.text}</span>
        {toast.onOpen && (
          <button
            type="button"
            className="ink-btn ink-btn--secondary tour-toast__open"
            onClick={() => {
              toast.onOpen?.();
              onClose();
            }}
          >
            {t('tutorial.toast.open')}
          </button>
        )}
      </div>
    </InTopLayer>
  );
}
