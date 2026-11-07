import { Icon } from '@inkadra/ui';
import { type ReactNode, useEffect, useState } from 'react';
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
  return (
    <InTopLayer>
      <div className="tour-pill" role="status">
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
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, onClose]);
  return (
    <InTopLayer>
      <div
        className="tour-toast"
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
