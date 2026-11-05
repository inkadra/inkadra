import { Icon } from '@inkadra/ui';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/** The screenplay import's tile: the light blue of the mockup, from the tag palette. */
const SCRIPT_TILE = {
  '--kind-fg': 'var(--ink-tag-blue)',
  '--kind-bg': 'var(--ink-tag-blue-bg)',
} as CSSProperties;

/**
 * An empty board's screenplay import and editing hints.
 * Only for people who can edit; the canvas hides it as soon as the board has a card.
 */
export function EmptyBoardStart({ onScreenplay }: { onScreenplay: () => void }) {
  const { t } = useTranslation();
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
        <button
          type="button"
          className="canvas__start-option canvas__start-option--screenplay"
          onClick={onScreenplay}
        >
          <span className="canvas__start-tile" style={SCRIPT_TILE} aria-hidden="true">
            <Icon name="page" size={18} />
          </span>
          <span className="canvas__start-name">{t('board.empty.screenplay')}</span>
          <span className="canvas__start-desc">{t('board.empty.screenplayBody')}</span>
        </button>
      </div>
      <p className="canvas__start-hint">
        <span className="canvas__empty-pointer">{t('board.empty.hint')}</span>
        <span className="canvas__empty-touch">{t('board.empty.hintTouch')}</span>
      </p>
    </section>
  );
}
