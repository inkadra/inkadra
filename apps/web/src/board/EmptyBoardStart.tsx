import type { ModuleId } from '@inkadra/shared';
import { Icon, kindStyle } from '@inkadra/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModules } from '../lib/modules.ts';
import { boardKindChoices, type NewBoardKind } from './board-kinds.ts';
import { kindIcon } from './views.ts';

/** The screenplay import's tile: the light blue of the mockup, from the tag palette. */
const SCRIPT_TILE = {
  '--kind-fg': 'var(--ink-tag-blue)',
  '--kind-bg': 'var(--ink-tag-blue-bg)',
} as CSSProperties;

/** The boards a short film starts from, after the screenplay, as in the mockup of #312. */
const START_KINDS = ['production', 'storyboard', 'moodboard'] as const;
const ADD_LABEL = {
  production: 'nav.addProduction',
  storyboard: 'nav.addStoryboard',
  moodboard: 'nav.addMoodboard',
} as const;

function Option({
  name,
  desc,
  icon,
  style,
  off,
  label,
  onClick,
}: {
  name: string;
  desc: string;
  icon: ReactNode;
  style: CSSProperties;
  off: boolean;
  /** The accessible name, when it says more than the visible one. */
  label?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`canvas__start-option${off ? ' is-off' : ''}`}
      aria-label={label}
      onClick={onClick}
    >
      <span className="canvas__start-tile" style={style} aria-hidden="true">
        {icon}
      </span>
      <span className="canvas__start-name">{name}</span>
      <span className="canvas__start-desc">{desc}</span>
      {off && <span className="canvas__start-tag">{t('modules.turnOn')}</span>}
    </button>
  );
}

/**
 * An empty board's starting points: the screenplay import and the boards of a short film, the
 * same choices as the Canvas menu. A module that is off stays, dimmed, with Turn on; the
 * project's one Production board, when it exists, opens instead (decisions 0121, 0123).
 * Only for people who can edit; the canvas hides it as soon as the board has a card.
 */
export function EmptyBoardStart({
  onScreenplay,
  onCanvas,
  onProduction,
  onModuleOn,
}: {
  onScreenplay: () => void;
  onCanvas: (kind: Exclude<NewBoardKind, 'board'>) => void;
  /** Opens the project's Production board; only when there is one. */
  onProduction?: (() => void) | undefined;
  onModuleOn: (id: ModuleId) => void;
}) {
  const { t } = useTranslation();
  const { offers } = useModules();
  const scriptOn = offers('menus', 'screenplayImport');
  const kinds = boardKindChoices(offers, !!onProduction, START_KINDS);
  return (
    <section
      className="canvas__start"
      aria-labelledby="canvas-start-title"
      data-chrome
      data-tour="canvas-start"
    >
      <h2 id="canvas-start-title" className="canvas__start-title">
        {t('board.empty.title')}
      </h2>
      {/* A finger gets its own wording (board.css). */}
      <p className="canvas__start-body">
        <span className="canvas__empty-pointer">{t('board.empty.body')}</span>
        <span className="canvas__empty-touch">{t('board.empty.bodyTouch')}</span>
      </p>
      <div className="canvas__start-options">
        <Option
          name={t('board.empty.screenplay')}
          desc={t(scriptOn ? 'board.empty.screenplayBody' : 'modules.off')}
          icon={<Icon name="page" size={18} />}
          style={SCRIPT_TILE}
          off={!scriptOn}
          label={scriptOn ? undefined : t('modules.kindOff', { name: t('board.empty.screenplay') })}
          onClick={scriptOn ? onScreenplay : () => onModuleOn('storyboard')}
        />
        {kinds.map(({ kind, owner, off, present }) => {
          const name = t(present ? 'film.views.production' : ADD_LABEL[kind]);
          return (
            <Option
              key={kind}
              name={name}
              desc={t(
                off
                  ? 'modules.off'
                  : present
                    ? 'board.canvasMenu.present'
                    : `board.canvasMenu.desc.${kind}`,
              )}
              icon={<Icon name={kindIcon(kind)} size={18} />}
              style={kindStyle(kind)}
              off={off}
              label={off ? t('modules.kindOff', { name }) : undefined}
              onClick={() =>
                off && owner ? onModuleOn(owner) : present ? onProduction?.() : onCanvas(kind)
              }
            />
          );
        })}
      </div>
      <p className="canvas__start-hint">
        <span className="canvas__empty-pointer">{t('board.empty.hint')}</span>
        <span className="canvas__empty-touch">{t('board.empty.hintTouch')}</span>
      </p>
    </section>
  );
}
