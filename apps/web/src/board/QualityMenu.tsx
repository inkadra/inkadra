import type { Asset, VideoRung } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rungLabel, shortSide } from './video-player.ts';
import type { QualityChoice } from './video-source.ts';

/**
 * The Quality chip in the bar of the video player, on cards and in the viewers (decisions 0128,
 * 0133): Auto (the player follows the connection), the ready rungs, those in preparation greyed
 * with their percentage, and the original when it plays in the browser.
 */
export function QualityMenu({
  asset,
  choice,
  onChoose,
  playing,
  compact = false,
}: {
  asset: Asset;
  choice: QualityChoice;
  onChoose: (choice: QualityChoice) => void;
  /** Short side of the level playing on Auto, when the player says it. */
  playing: number | null;
  /** A narrow player: the chip names only the height. */
  compact?: boolean;
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
    asset.height && asset.width ? rungLabel(shortSide(asset)) : null,
    mbps ? `${mbps} Mbit/s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const label =
    choice === 'auto'
      ? compact && playing
        ? rungLabel(playing)
        : auto
      : choice === 'original'
        ? t('viewer.quality.original')
        : rungLabel(choice);
  const pick = (next: QualityChoice) => {
    onChoose(next);
    setOpen(false);
    button.current?.focus();
  };
  const item = (value: QualityChoice, text: string, note?: ReactNode, disabled = false) => (
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
        <span>{label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="viewer-quality__pop">
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
            <div className="viewer-quality__title" aria-hidden="true">
              {t('viewer.quality.title')}
            </div>
            {item(
              'auto',
              t('viewer.quality.auto'),
              playing ? t('viewer.quality.now', { quality: rungLabel(playing) }) : null,
            )}
            {rungs.map((r) =>
              item(
                r.name as VideoRung,
                rungLabel(r.name),
                r.status === 'ready' ? null : r.live ? (
                  <>
                    <span className="live-tag">{t('viewer.quality.live')}</span>
                    {r.status === 'processing' &&
                      ` · ${t('viewer.quality.liveCopy', { percent: r.progress ?? 0 })}`}
                  </>
                ) : (
                  t('viewer.quality.preparing', { percent: r.progress ?? 0 })
                ),
                // A rung offered live plays before its file is made (decision 0128).
                r.status !== 'ready' && !r.live,
              ),
            )}
            {original && (
              <>
                <hr className="menu__divider" />
                {item('original', t('viewer.quality.original'), originalNote)}
              </>
            )}
          </div>
          {rungs.some((r) => r.live && r.status !== 'ready') && (
            // Outside the menu (only items belong there): what the "al volo" levels are, and that
            // playback moves to the copy only when one is being made.
            <p className="viewer-quality__note">
              {t(
                rungs.some((r) => r.live && r.status !== 'ready' && !r.liveOnly)
                  ? 'viewer.quality.liveNote'
                  : 'viewer.quality.liveOnlyNote',
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
