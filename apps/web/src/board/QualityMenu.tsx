import type { Asset, VideoRung } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QualityChoice } from './video-source.ts';

/** `720p`, `4K`: how a rung or a height is named. */
export const rungLabel = (height: number | string) =>
  Number(height) >= 2000 ? '4K' : `${Number(height)}p`;

/**
 * The Quality button over a video in the viewer (decision 0128): Auto (the player follows the
 * connection), the ready rungs, those in preparation greyed with their percentage, and the
 * original when it plays in the browser. The browser's own controls stay as they are.
 */
export function QualityMenu({
  asset,
  choice,
  onChoose,
  playing,
}: {
  asset: Asset;
  choice: QualityChoice;
  onChoose: (choice: QualityChoice) => void;
  /** Height playing on Auto, when the player says it. */
  playing: number | null;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const rungs = [...(asset.playback?.renditions ?? [])]
    .filter((r) => r.status !== 'failed')
    .sort((a, b) => Number(b.name) - Number(a.name));
  const auto = playing
    ? t('viewer.quality.autoAt', { quality: rungLabel(playing) })
    : t('viewer.quality.auto');
  const original = asset.playback?.original === true;
  const mbps =
    asset.durationMs && asset.durationMs > 0
      ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
          (asset.size * 8) / asset.durationMs / 1000,
        )
      : null;
  const originalNote = [
    asset.height && asset.width ? rungLabel(Math.min(asset.width, asset.height)) : null,
    mbps ? `${mbps} Mbit/s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const label =
    choice === 'auto'
      ? auto
      : choice === 'original'
        ? t('viewer.quality.original')
        : rungLabel(rungs.find((r) => r.name === choice)?.height ?? choice);
  const pick = (next: QualityChoice) => {
    onChoose(next);
    setOpen(false);
    button.current?.focus();
  };
  const item = (value: QualityChoice, text: string, note?: string | null, disabled = false) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={choice === value}
      disabled={disabled}
      className="ink-menu__item menu__item viewer-quality__item"
      onClick={() => pick(value)}
    >
      <Icon name="check" size={12} />
      {text}
      {note && <small>{note}</small>}
    </button>
  );
  return (
    <div className="viewer-quality" data-tour="video-quality">
      <button
        ref={button}
        type="button"
        className="viewer-quality__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('viewer.quality.label', { quality: label })}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="settings" size={14} />
        <span>{label}</span>
      </button>
      {open && (
        <div
          ref={menu}
          className="ink-menu menu viewer-quality__menu"
          role="menu"
          aria-label={t('viewer.quality.title')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              const all = [
                ...(menu.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitemradio"]:not(:disabled)',
                ) ?? []),
              ];
              const i = all.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? all.length - 1
                    : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
              all[next]?.focus();
            }
          }}
        >
          {item(
            'auto',
            t('viewer.quality.auto'),
            playing ? t('viewer.quality.now', { quality: rungLabel(playing) }) : null,
          )}
          <hr className="menu__divider" />
          {rungs.map((r) =>
            item(
              r.name as VideoRung,
              rungLabel(r.height ?? r.name),
              r.status === 'ready'
                ? null
                : t('viewer.quality.preparing', { percent: r.progress ?? 0 }),
              r.status !== 'ready',
            ),
          )}
          {original && (
            <>
              <hr className="menu__divider" />
              {item('original', t('viewer.quality.original'), originalNote)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
