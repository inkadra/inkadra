import { Button, IconButton } from '@inkadra/ui';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateInputValue, endOfDay, expiresSoon, expiryBounds, expiryDate } from '../lib/access.ts';

/** "Expires 15 Dec" in muted text; in the warning colour within three days (decision 0041). */
export function ExpiryLabel({ at }: { at: string }) {
  const { t } = useTranslation();
  const locale = document.documentElement.lang || 'it';
  return (
    <span className={expiresSoon(at) ? 'share__expiry share__expiry--soon' : 'share__expiry'}>
      {t('share.expiry.label', { date: expiryDate(at, locale) })}
    </span>
  );
}

/**
 * A small date control behind a clock button: when someone's access ends. Owners never have
 * one, so callers do not show it for them.
 */
export function ExpiryPicker({
  value,
  label,
  onChange,
}: {
  value: string | null;
  /** Accessible name of the button, e.g. "End of access for Anna". */
  label: string;
  onChange: (expiresAt: string | null) => Promise<unknown> | void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('');
  // Placed against the window: the people list scrolls and would cut a popover inside it.
  const [place, setPlace] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const bounds = expiryBounds();

  useEffect(() => {
    if (!open) return;
    setDay(value ? dateInputValue(new Date(value)) : '');
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, value]);

  // Not a form: the picker also sits inside the invitation form.
  async function submit() {
    const at = endOfDay(day);
    if (!at) return;
    setOpen(false);
    await onChange(at);
  }

  return (
    <div className="share__expiry-menu" ref={box}>
      <IconButton
        icon="clock"
        label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={value ? 'share__expiry-btn share__expiry-btn--set' : 'share__expiry-btn'}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const width = Math.min(240, window.innerWidth - 16);
          const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
          const below = r.bottom + 6 + 230 <= window.innerHeight;
          setPlace({
            width,
            left,
            ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
          });
          setOpen((o) => !o);
        }}
      />
      {open && (
        <fieldset id={id} className="share__expiry-pop" style={place} aria-label={label}>
          <label className="share__expiry-field">
            <span>{t('share.expiry.until')}</span>
            <input
              className="share__input share__date"
              type="date"
              required
              min={bounds.min}
              max={bounds.max}
              value={day}
              // biome-ignore lint/a11y/noAutofocus: the popover opens for this field only.
              autoFocus
              onChange={(e) => setDay(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void submit();
              }}
            />
          </label>
          <p className="share__expiry-help">{t('share.expiry.help')}</p>
          <div className="share__expiry-actions">
            {value && (
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  void onChange(null);
                }}
              >
                {t('share.expiry.clear')}
              </Button>
            )}
            <Button variant="primary" disabled={!endOfDay(day)} onClick={() => void submit()}>
              {t('share.expiry.save')}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
