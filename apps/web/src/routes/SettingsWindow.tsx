import type { InstanceMember } from '@inkadra/shared';
import { IconButton } from '@inkadra/ui';
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { DiagnosticsContext, SaveStatus, SettingsNav } from './SettingsShell.tsx';
import { autosaves, isSettingsHome, settingsSection } from './settings-sections.ts';
import { useIsPhone } from './settings-ui.tsx';
import './settings.css';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

/** Active members, shown next to Members in the navigation. */
function useMemberCount(admin: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    api
      .get<{ items: InstanceMember[] }>('/instance/members')
      .then((r) => alive && setCount(r.items.filter((m) => !m.deactivatedAt).length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [admin]);
  return count;
}

/**
 * Settings as a modal window over the page that opened them (a full-screen sheet on phones).
 * Escape, the close button and a click on the backdrop all call `onClose`; the window does not
 * close itself, so the URL stays the single source of truth for whether it is open.
 */
export function SettingsWindow({
  setup,
  onClose,
  onBack,
  onDiagnostics,
  children,
}: {
  setup: Setup;
  onClose: () => void;
  /** Phones: from a page back to the list of pages. */
  onBack: () => void;
  onDiagnostics?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { pathname, search } = useLocation();
  const phone = useIsPhone();
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const closingSelf = useRef(false);
  const titleId = useId();
  const members = useMemberCount(user?.role === 'admin');
  const list = phone && isSettingsHome(pathname, search);
  const page = settingsSection(pathname, search);

  // Layout effect: the dialog must close while still in the document for the browser to hand
  // focus back to whatever opened it; the explicit focus covers browsers that do not.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.open) el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // No scrolling into view: on phones that pans the visual viewport and the window looks
    // off-centre.
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      closingSelf.current = true;
      if (el.open) el.close();
      closingSelf.current = false;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Nested dialogs (password, tokens…) are DOM children: their events must not close this one.
  const own = (e: SyntheticEvent) => e.target === e.currentTarget;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop's keyboard path is Escape (onCancel).
    <dialog
      ref={ref}
      className={phone ? 'settings-window settings-window--phone' : 'settings-window'}
      aria-labelledby={titleId}
      aria-modal="true"
      tabIndex={-1}
      onCancel={(e) => {
        if (!own(e)) return;
        e.preventDefault();
        onClose();
      }}
      onClose={(e) => {
        // Only when the browser closed it anyway (a repeated Escape cannot be cancelled), never
        // for the window's own close on unmount or in strict mode's close-and-reopen; browsers
        // queue the event, so by then the window may be open again.
        if (own(e) && !closingSelf.current && !e.currentTarget.open) onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = own(e);
      }}
      onClick={(e) => {
        if (own(e) && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <DiagnosticsContext.Provider value={onDiagnostics}>
        <div className="settings-window__frame">
          {!phone && <SettingsNav setup={setup} members={members} onClose={onClose} />}
          <section className="settings-window__main">
            <header className="settings-window__head">
              {phone && !list && (
                <IconButton
                  className="settings-window__back"
                  icon="chevronRight"
                  label={t('mobile.back')}
                  onClick={onBack}
                />
              )}
              <h2 id={titleId} tabIndex={-1}>
                {list ? t('settingsUi.profile') : t(page.title)}
              </h2>
              {!list && autosaves(page.id) && <SaveStatus />}
              <IconButton icon="close" label={t('settingsUi.close')} onClick={onClose} />
            </header>
            <div className="settings-window__body" key={list ? 'list' : page.id}>
              {children}
            </div>
          </section>
        </div>
      </DiagnosticsContext.Provider>
    </dialog>
  );
}
