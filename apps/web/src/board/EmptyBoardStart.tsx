import { Icon, type IconName, kindStyle } from '@inkadra/ui';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/** The screenplay import's tile: the light blue of the mockup, from the tag palette. */
const SCRIPT_TILE = {
  '--kind-fg': 'var(--ink-tag-blue)',
  '--kind-bg': 'var(--ink-tag-blue-bg)',
} as CSSProperties;

/**
 * An empty board's starting points (#312): a quiet card in the middle of the board with the
 * moodboard and storyboard templates, the screenplay import and the full list of templates.
 * Only for people who can edit; the canvas hides it as soon as the board has a card.
 */
export function EmptyBoardStart({
  onMoodboard,
  onStoryboard,
  onScreenplay,
  onBrowse,
}: {
  onMoodboard: () => void;
  onStoryboard: () => void;
  onScreenplay: () => void;
  /** Opens the Canvas menu, which lists every template. */
  onBrowse: () => void;
}) {
  const { t } = useTranslation();
  const options: Array<{
    id: string;
    icon: IconName;
    style: CSSProperties;
    name: string;
    body: string;
    run: () => void;
  }> = [
    {
      id: 'moodboard',
      icon: 'image',
      style: kindStyle('moodboard'),
      name: t('templates.moodboard.name'),
      body: t('board.empty.moodboard'),
      run: onMoodboard,
    },
    {
      id: 'storyboard',
      icon: 'storyboard',
      style: kindStyle('storyboard'),
      name: t('templates.storyboard.name'),
      body: t('board.empty.storyboard'),
      run: onStoryboard,
    },
    {
      id: 'screenplay',
      icon: 'page',
      style: SCRIPT_TILE,
      name: t('board.empty.screenplay'),
      body: t('board.empty.screenplayBody'),
      run: onScreenplay,
    },
  ];
  return (
    <section className="canvas__start" aria-labelledby="canvas-start-title" data-chrome>
      <h2 id="canvas-start-title" className="canvas__start-title">
        {t('board.empty.title')}
      </h2>
      {/* A finger gets its own wording (board.css). */}
      <p className="canvas__start-body">
        <span className="canvas__empty-pointer">{t('board.empty.body')}</span>
        <span className="canvas__empty-touch">{t('board.empty.bodyTouch')}</span>
      </p>
      <div className="canvas__start-options">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`canvas__start-option canvas__start-option--${o.id}`}
            onClick={o.run}
          >
            <span className="canvas__start-tile" style={o.style} aria-hidden="true">
              <Icon name={o.icon} size={18} />
            </span>
            <span className="canvas__start-name">{o.name}</span>
            <span className="canvas__start-desc">{o.body}</span>
          </button>
        ))}
      </div>
      <button type="button" className="canvas__start-browse" onClick={onBrowse}>
        {t('board.empty.browse')}
        <span aria-hidden="true"> →</span>
      </button>
      <p className="canvas__start-hint">
        <span className="canvas__empty-pointer">{t('board.empty.hint')}</span>
        <span className="canvas__empty-touch">{t('board.empty.hintTouch')}</span>
      </p>
    </section>
  );
}
