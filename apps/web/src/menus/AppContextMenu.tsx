import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './context-menu.css';

type Entry = { label: string; run: () => void | Promise<void> };
type OpenMenu = {
  x: number;
  y: number;
  origin: HTMLElement;
  entries: Entry[];
  editing: boolean;
  container: HTMLElement;
};

/** Last-resort menu: local React handlers (canvas/projects) get first refusal. */
export function AppContextMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuHost = useRef<HTMLElement | null>(null);
  const close = (restore = false) => {
    if (restore && menu?.origin.isConnected) menu.origin.focus({ preventScroll: true });
    setMenu(null);
  };
  useEffect(() => {
    const open = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        setMenu(null);
        return;
      }
      if (!(event.target instanceof Element)) return;
      event.preventDefault();
      const origin = event.target;
      const field = origin.closest<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
      const editor = origin.closest<HTMLElement>('[contenteditable="true"]');
      const privateField = field instanceof HTMLInputElement && field.type === 'password';
      const text = privateField
        ? ''
        : field
          ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
          : (window.getSelection()?.toString() ?? '');
      const range =
        !field && window.getSelection()?.rangeCount
          ? window.getSelection()?.getRangeAt(0).cloneRange()
          : undefined;
      const entries: Entry[] = [];
      // Clipboard reads require permissions unavailable synchronously at menu-open time.
      // Never pretend paste/cut works: keep their native keyboard path discoverable instead.
      if (text && window.isSecureContext && navigator.clipboard?.writeText) {
        entries.push({ label: t('context.copy'), run: () => navigator.clipboard.writeText(text) });
      }
      if (field && !field.disabled && field.selectionStart !== null) {
        entries.push({
          label: t('context.selectAll'),
          run: () => {
            field.focus();
            field.select();
          },
        });
      } else if (editor) {
        entries.push({
          label: t('context.selectAll'),
          run: () => {
            editor.focus();
            const all = document.createRange();
            all.selectNodeContents(editor);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(all);
          },
        });
      }
      const link = origin.closest<HTMLAnchorElement>('a[href]');
      if (link && link.origin === window.location.origin && /^https?:$/.test(link.protocol)) {
        entries.push({ label: t('context.openLink'), run: () => link.click() });
      }
      entries.push({
        label: t('nav.home'),
        run: () => {
          window.location.assign('/');
        },
      });
      if (window.history.length > 1)
        entries.push({ label: t('context.back'), run: () => window.history.back() });
      // Restore the clicked selection after focusing menu controls, before copying it.
      const wrapped = entries.map((entry) => ({
        ...entry,
        run: () => {
          if (range) {
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
          }
          return entry.run();
        },
      }));
      const box = origin.getBoundingClientRect();
      setError('');
      const container = origin.closest<HTMLDialogElement>('dialog[open]') ?? document.body;
      menuHost.current = container;
      setMenu({
        container,
        x: event.clientX || box.left,
        y: event.clientY || box.bottom,
        origin:
          origin.closest<HTMLElement>(
            'button,a[href],input,textarea,select,[tabindex],[contenteditable="true"]',
          ) ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : document.body),
        entries: wrapped,
        editing: !!field || !!editor,
      });
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      )
        return;
      event.preventDefault();
      // Dispatch through local handlers too; never act on an unrelated selection.
      const target = event.target instanceof Element ? event.target : document.body;
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: box.left,
          clientY: box.bottom,
        }),
      );
    };
    window.addEventListener('contextmenu', open);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('contextmenu', open);
      window.removeEventListener('keydown', key);
    };
  }, [t]);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const node = ref.current;
    const box = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`;
    node.querySelector('button')?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('close', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('close', dismiss, true);
    };
  }, [menu]);
  return (
    <>
      {children}
      {error &&
        createPortal(
          <div className="app-context-error" role="status">
            {error}
          </div>,
          menuHost.current?.isConnected ? menuHost.current : document.body,
        )}
      {menu &&
        createPortal(
          <div
            ref={ref}
            className="app-context-menu"
            role="menu"
            aria-label={t('context.actions')}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }
              const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : event.key === 'ArrowDown'
                      ? (index + 1) % buttons.length
                      : event.key === 'ArrowUp'
                        ? (index - 1 + buttons.length) % buttons.length
                        : null;
              if (next !== null) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {menu.entries.map((entry) => (
              <button
                type="button"
                role="menuitem"
                key={entry.label}
                onClick={() => {
                  close(true);
                  void Promise.resolve()
                    .then(entry.run)
                    .catch(() => setError(t('context.copyFailed')));
                }}
              >
                {entry.label}
              </button>
            ))}
            {menu.editing && <p>{t('context.editHint')}</p>}
          </div>,
          menu.container,
        )}
    </>
  );
}
