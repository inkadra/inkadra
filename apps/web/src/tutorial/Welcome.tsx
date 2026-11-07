import { type ContentKind, Icon, type IconName, kindStyle, toolStyle } from '@inkadra/ui';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../lib/phone.ts';

/** A modal of the tutorials: a centred card, a sheet from the bottom on a phone. */
function Modal({
  label,
  className,
  onCancel,
  children,
}: {
  label: string;
  className: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const phone = useIsPhone();
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`tour-modal ${className}${phone ? ' tour-modal--sheet' : ''}`}
      aria-labelledby={label}
      onCancel={(e) => {
        e.preventDefault();
        ref.current?.close();
        onCancel();
      }}
    >
      {children}
    </dialog>
  );
}

const KINDS: Array<[ContentKind, IconName]> = [
  ['moodboard', 'image'],
  ['storyboard', 'storyboard'],
  ['shotlist', 'shotlist'],
  ['schedule', 'calendar'],
  ['review', 'people'],
];

/** First sign-in: what Inkadra is, and the offer of the guided tour (#502). */
export function Welcome({ onTour, onSkip }: { onTour: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal label="tour-welcome-title" className="tour-welcome" onCancel={onSkip}>
      <div className="tour-hero" aria-hidden="true">
        <div className="tour-hero__card tour-hero__note" style={toolStyle('note')}>
          <b>{t('tutorial.welcome.heroNote')}</b>
          <i />
          <i />
          <i />
        </div>
        <div className="tour-hero__card tour-hero__pic tm-pic tm-pic--a" />
        <div className="tour-hero__card tour-hero__strip">
          <span className="tm-kind" style={kindStyle('storyboard')}>
            <Icon name="storyboard" size={11} />
            {t('film.views.storyboard')}
          </span>
          <i className="tm-pic tm-pic--a" />
          <i className="tm-pic tm-pic--b" />
          <i className="tm-pic tm-pic--c" />
        </div>
        <div className="tour-hero__card tour-hero__palette">
          <i style={{ background: '#E07A3F' }} />
          <i style={{ background: '#1E3A4C' }} />
          <i style={{ background: '#F2C76E' }} />
        </div>
        <div className="tour-hero__card tour-hero__todo">
          <span className="is-done">
            <i />
            {t('tutorial.welcome.heroTodoDone')}
          </span>
          <span>
            <i />
            {t('tutorial.welcome.heroTodo')}
          </span>
        </div>
        <span className="tm-cur tour-hero__cursor">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 1l11 6-5 1.5L6 14z" />
          </svg>
        </span>
      </div>
      <div className="tour-welcome__body">
        <p className="tour-welcome__eyebrow">{t('tutorial.welcome.eyebrow')}</p>
        <h2 id="tour-welcome-title">{t('tutorial.welcome.title')}</h2>
        <p className="tour-welcome__lead">{t('tutorial.welcome.lead')}</p>
        <ul className="tour-welcome__kinds">
          {KINDS.map(([kind, icon], i) => (
            <li key={kind} style={{ ...kindStyle(kind), animationDelay: `${0.9 + i * 0.08}s` }}>
              <Icon name={icon} size={13} />
              {t(`film.views.${kind}`)}
            </li>
          ))}
        </ul>
        <div className="tour-welcome__actions">
          <button
            type="button"
            className="ink-btn ink-btn--primary ink-btn--lg"
            // biome-ignore lint/a11y/noAutofocus: the dialog's first choice, as in the mockup
            autoFocus
            onClick={onTour}
          >
            <Icon name="play" size={13} />
            {t('tutorial.welcome.go')}
          </button>
          <button type="button" className="ink-btn ink-btn--secondary ink-btn--lg" onClick={onSkip}>
            {t('tutorial.welcome.skip')}
          </button>
        </div>
        <p className="tour-welcome__foot">{t('tutorial.welcome.foot')}</p>
      </div>
    </Modal>
  );
}

const BURST = [
  'var(--ink-tool-note)',
  'var(--ink-tool-image)',
  'var(--ink-tool-link)',
  'var(--ink-tool-todo)',
  'var(--ink-tool-color)',
  'var(--ink-tag-purple)',
  'var(--ink-tag-green)',
  'var(--ink-tag-pink)',
  'var(--ink-tool-table)',
  'var(--ink-tool-map)',
];

/** The end of the guided tour, with the feature tours still to come. */
export function Finale({ more, onClose }: { more: number; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal label="tour-finale-title" className="tour-finale" onCancel={onClose}>
      <div className="tour-finale__burst" aria-hidden="true">
        {BURST.map((color, i) => {
          const a = (i / BURST.length) * Math.PI * 2;
          const d = 70 + (i % 3) * 18;
          return (
            <i
              key={color}
              style={
                {
                  background: color,
                  '--x': `${Math.cos(a) * d}px`,
                  '--y': `${Math.sin(a) * d}px`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <svg className="tour-finale__check" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="30" />
        <path d="M20 33l8 8 16-17" />
      </svg>
      <h2 id="tour-finale-title">{t('tutorial.finale.title')}</h2>
      <p>{t('tutorial.finale.text')}</p>
      <ul className="tour-finale__mini">
        {KINDS.slice(1).map(([kind, icon], i) => (
          <li key={kind} style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
            <Icon name={icon} size={14} contentKind={kind} />
            {t(`film.views.${kind}`)} <em>{t('tutorial.settings.duration')}</em>
          </li>
        ))}
        <li style={{ animationDelay: '0.85s' }}>
          <em>{t('tutorial.finale.more', { count: more })}</em>
        </li>
      </ul>
      <button
        type="button"
        className="ink-btn ink-btn--primary ink-btn--lg"
        // biome-ignore lint/a11y/noAutofocus: the only action
        autoFocus
        onClick={onClose}
      >
        {t('tutorial.finale.go')}
      </button>
    </Modal>
  );
}
