import {
  type ContentKind,
  Icon,
  type IconName,
  kindStyle,
  type ToolKind,
  toolStyle,
} from '@inkadra/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaId } from './tours.ts';

/**
 * The short looping scenes above a step's text (#502): CSS only, transform and opacity, still
 * with reduced motion (tutorial.css). Decorative: hidden from assistive technology, since the
 * step's title and line say the same.
 */

const Cursor = ({ className }: { className: string }) => (
  <span className={`tm-cur ${className}`}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 1l11 6-5 1.5L6 14z" />
    </svg>
  </span>
);

const Kind = ({ kind, icon, label }: { kind: ContentKind; icon: IconName; label?: string }) => (
  <span className="tm-kind" style={kindStyle(kind)}>
    <Icon name={icon} size={13} />
    {label}
  </span>
);

const delay = (s: number) => ({ animationDelay: `${s}s` }) as CSSProperties;
const tool = (t: ToolKind) => toolStyle(t);
const PICS = ['tm-pic--a', 'tm-pic--b', 'tm-pic--c', 'tm-pic--d'];
const Lines = ({ n = 3 }: { n?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
      <i key={i} className="tm-line" style={{ width: `${90 - i * 18}%` }} />
    ))}
  </>
);

function Scene({ id }: { id: MediaId }): ReactNode {
  const { t } = useTranslation();
  const views = (['storyboard', 'shotlist', 'schedule', 'review'] as const).map((k) => ({
    k,
    label: t(`film.views.${k}`),
  }));
  switch (id) {
    case 'types':
      return views.map(({ k, label }, i) => (
        <div key={k} className="tm-row tm-loop-in" style={{ top: 12 + i * 28, ...delay(i * 0.12) }}>
          <Kind kind={k} icon={k === 'schedule' ? 'calendar' : k === 'review' ? 'people' : k} />
          <b>{label}</b>
          <i className="tm-line" style={{ maxWidth: 90 - i * 14 }} />
        </div>
      ));
    case 'search':
      return (
        <>
          <div className="tm-search tm-loop-pop">
            <Icon name="search" size={14} />
            <span className="tm-typed">{t('tutorial.media.searchWord')}</span>
            <span className="tm-kbd">⌘K</span>
          </div>
          <div className="tm-results tm-loop-late">
            <span className="is-on">
              <Icon name="storyboard" size={13} /> {t('tutorial.media.scene')}
            </span>
            <span>
              <Icon name="image" size={13} /> {t('tutorial.media.picture')}
            </span>
          </div>
        </>
      );
    case 'drag':
      return (
        <>
          <div className="tm-note tm-loop-drop" style={tool('note')}>
            <Lines />
          </div>
          <div className="tm-dock">
            {(['note', 'image', 'link', 'todo', 'color'] as const).map((k, i) => (
              <i key={k} style={tool(k)} className={i === 0 ? 'tm-tap' : undefined} />
            ))}
          </div>
          <Cursor className="tm-cur--drag" />
        </>
      );
    case 'toolbar':
      return (
        <>
          <div className="tm-bar tm-loop-bar">
            {(['bold', 'note', 'color', 'trash', 'more'] as const).map((n) => (
              <i key={n}>
                <Icon name={n} size={12} />
              </i>
            ))}
          </div>
          <div className="tm-card tm-card--sel">
            <span className="tm-ring" />
            <Lines />
          </div>
          <Cursor className="tm-cur--click" />
        </>
      );
    case 'morph':
      return (
        <>
          <span className="tm-label tm-label--a" style={kindStyle('storyboard')}>
            {t('film.views.storyboard')}
          </span>
          <span className="tm-label tm-label--b" style={kindStyle('shotlist')}>
            {t('film.views.shotlist')}
          </span>
          {PICS.slice(0, 3).map((p, i) => (
            <div key={p} className={`tm-morph tm-morph--${i}`}>
              <div className={`tm-pic ${p}`} />
              <i className="tm-line" />
            </div>
          ))}
        </>
      );
    case 'team':
      return (
        <>
          <div className="tm-pic tm-pic--d tm-team-card" />
          <span className="tm-chip tm-chip--ok tm-loop-pop" style={delay(1)}>
            {t('tutorial.media.approved')}
          </span>
          <span className="tm-bubble tm-loop-pop">{t('tutorial.media.comment')}</span>
          <span className="tm-who tm-who--a" style={tool('voice')}>
            <Cursor className="" />
            <b>Ada</b>
          </span>
          <span className="tm-who tm-who--b" style={tool('map')}>
            <Cursor className="" />
            <b>Leo</b>
          </span>
        </>
      );
    case 'gear':
      return (
        <>
          <span className="tm-gear">
            <Icon name="settings" size={34} />
          </span>
          <div className="tm-setrow">
            {t('tutorial.settings.welcomeTitle')}
            <span className="tm-play tm-press">
              <Icon name="play" size={10} /> {t('tutorial.settings.play')}
            </span>
          </div>
          <div className="tm-setrow tm-setrow--2">
            {t('tutorial.tours.storyboard.name')}
            <span className="tm-seen">
              <Icon name="check" size={12} /> {t('tutorial.settings.seen')}
            </span>
          </div>
        </>
      );
    case 'scenes':
      return (
        <>
          <div className="tm-row" style={{ top: 14 }}>
            <b>{t('tutorial.media.scene')}</b>
            <Kind kind="storyboard" icon="storyboard" label="4" />
          </div>
          {PICS.map((p, i) => (
            <div
              key={p}
              className="tm-frame tm-loop-pop"
              style={{ left: 22 + i * 66, ...delay(i * 0.15) }}
            >
              <div className={`tm-pic ${p}`} />
              <b>1{'ABCD'[i]}</b>
            </div>
          ))}
        </>
      );
    case 'meta':
      return (
        <div className="tm-framecard">
          <div className="tm-pic tm-pic--a" />
          <span className="tm-chips">
            <span className="tm-loop-pop" style={kindStyle('storyboard')}>
              PP
            </span>
            <span className="tm-loop-pop" style={{ ...kindStyle('review'), ...delay(0.25) }}>
              35 mm
            </span>
            <span className="tm-loop-pop" style={{ ...kindStyle('shotlist'), ...delay(0.5) }}>
              {t('tutorial.media.dolly')}
            </span>
          </span>
        </div>
      );
    case 'draw':
      return (
        <svg className="tm-sketch" viewBox="0 0 200 108" aria-hidden="true">
          <path d="M14 86 L186 86 M40 86 L40 40 L70 40 L70 86 M120 86 C120 60 140 50 150 60 S170 80 160 86" />
          <path className="tm-sketch__b" d="M88 30 l18 -8 l0 16 z M106 30 L170 30" />
        </svg>
      );
    case 'pin':
      return (
        <>
          <div className="tm-pic tm-pic--a tm-pin-pic" />
          <span className="tm-pin tm-loop-pop">1</span>
          <span className="tm-bubble tm-bubble--pin tm-loop-pop" style={delay(0.5)}>
            {t('tutorial.media.comment')}
          </span>
          <Cursor className="tm-cur--pin" />
        </>
      );
    case 'bell':
      return [0, 1, 2].map((i) => (
        <div
          key={i}
          className="tm-inbox tm-loop-in"
          style={{ top: 14 + i * 36, ...delay(i * 0.2) }}
        >
          <span className="tm-dot" />
          <span className="tm-avatar">{['GB', 'LR', 'MA'][i]}</span>
          <Lines n={2} />
        </div>
      ));
    case 'play':
      return (
        <div className="tm-video">
          <div className="tm-pic tm-pic--b" />
          <span className="tm-video__play">
            <Icon name="play" size={16} />
          </span>
          <span className="tm-video__track">
            <i />
          </span>
        </div>
      );
    case 'grid':
      return (
        <>
          {['tm-pic--a', 'tm-pic--b', 'tm-pic--c', 'tm-pic--d', 'tm-pic--b', 'tm-pic--a'].map(
            (p, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
                key={i}
                className={`tm-pic ${p} tm-tile tm-loop-pop`}
                style={{
                  left: 18 + (i % 3) * 62,
                  top: 14 + Math.floor(i / 3) * 56,
                  ...delay(i * 0.1),
                }}
              />
            ),
          )}
          <div className="tm-swatches">
            {['#E07A3F', '#1E3A4C', '#F2C76E', '#0A0F14'].map((c, i) => (
              <i
                key={c}
                className="tm-loop-pop"
                style={{ background: c, ...delay(0.6 + i * 0.1) }}
              />
            ))}
          </div>
        </>
      );
    case 'rows':
      return [0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="tm-trow tm-loop-in"
          style={{ top: 12 + i * 28, ...delay(i * 0.12) }}
        >
          <b>1{'ABCD'[i]}</b>
          <div className={`tm-pic ${PICS[i]}`} />
          <i className="tm-line" />
          <span className="tm-chip" style={kindStyle(i % 2 ? 'shotlist' : 'storyboard')}>
            {['PP', 'CL', 'PM', 'MF'][i]}
          </span>
        </div>
      ));
    case 'calendar':
      return [0, 1, 2].map((d) => (
        <div key={d} className="tm-day" style={{ left: 16 + d * 86 }}>
          <b>{t('tutorial.media.day', { n: d + 1 })}</b>
          {[0, 1].map((s) => (
            <i
              key={s}
              className="tm-shot tm-loop-drop"
              style={{ ...kindStyle('schedule'), ...delay(d * 0.3 + s * 0.15) }}
            />
          ))}
        </div>
      ));
    case 'plan':
      return (
        <div className="tm-plan">
          <span className="tm-plan__wall" />
          <span className="tm-plan__cone" style={tool('plan')} />
          <span className="tm-plan__cam" style={tool('plan')}>
            <Icon name="planCamera" size={14} />
          </span>
          <span className="tm-plan__actor tm-loop-pop" />
          <span className="tm-plan__actor tm-plan__actor--b tm-loop-pop" style={delay(0.4)} />
        </div>
      );
    case 'sheet':
      return (
        <div className="tm-sheet">
          <span className="tm-avatar tm-avatar--big">MR</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="tm-section tm-loop-in" style={delay(i * 0.2)}>
              <Icon name="chevronDown" size={11} />
              <i className="tm-line" />
            </div>
          ))}
        </div>
      );
    case 'versions':
      return (
        <div className="tm-versions">
          <span className="tm-versions__line" />
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="tm-versions__dot tm-loop-pop"
              style={{ left: `${12 + i * 25}%`, ...delay(i * 0.2) }}
            />
          ))}
          <span className="tm-play tm-versions__restore tm-press">
            <Icon name="undo" size={10} /> {t('tutorial.media.restore')}
          </span>
        </div>
      );
    case 'slides':
      return (
        <div className="tm-slides">
          {PICS.map((p) => (
            <div key={p} className={`tm-pic ${p}`} />
          ))}
        </div>
      );
    case 'export':
      return (
        <>
          <div className="tm-page">
            <div className="tm-pic tm-pic--a" />
            <Lines n={2} />
          </div>
          <span className="tm-download tm-loop-drop">
            <Icon name="download" size={16} />
          </span>
        </>
      );
    case 'clip':
      return (
        <>
          <div className="tm-browser">
            <span className="tm-browser__bar">
              <i />
              <i />
              <i />
            </span>
            <div className="tm-pic tm-pic--c" />
          </div>
          <div className="tm-pic tm-pic--c tm-flyer" />
          <div className="tm-board-mini">
            <Icon name="board" size={14} />
          </div>
        </>
      );
    case 'phone':
      return (
        <div className="tm-phone">
          <div className="tm-pic tm-pic--a tm-loop-pop" />
          <div className="tm-note-mini tm-loop-pop" style={{ ...tool('note'), ...delay(0.3) }} />
          <span className="tm-phone__nav">
            {(['home', 'board', 'plus', 'inbox', 'user'] as const).map((n) => (
              <Icon key={n} name={n} size={10} />
            ))}
          </span>
        </div>
      );
    case 'tags':
      return (
        <div className="tm-tags">
          {(['storyboard', 'shotlist', 'schedule', 'review', 'moodboard'] as const).map((k, i) => (
            <span
              key={k}
              className="tm-chip tm-loop-pop"
              style={{ ...kindStyle(k), ...delay(i * 0.15) }}
            >
              {['PP', t('tutorial.media.dolly'), '35 mm', 'CL', t('tutorial.media.night')][i]}
            </span>
          ))}
        </div>
      );
    case 'backup':
      return [0, 1, 2].map((i) => (
        <div
          key={i}
          className="tm-inbox tm-loop-in"
          style={{ top: 18 + i * 34, ...delay(i * 0.25) }}
        >
          <span className="tm-ok">
            <Icon name="check" size={10} />
          </span>
          <b>{`0${3 + i}:00`}</b>
          <i className="tm-line" />
        </div>
      ));
    case 'users':
      return [0, 1, 2].map((i) => (
        <div
          key={i}
          className="tm-inbox tm-loop-in"
          style={{ top: 14 + i * 36, ...delay(i * 0.2) }}
        >
          <span className="tm-avatar">{['GB', 'LR', '+'][i]}</span>
          <i className="tm-line" />
          <span className="tm-chip" style={kindStyle(i === 2 ? 'storyboard' : 'board')}>
            {t(`tutorial.media.role${i}`)}
          </span>
        </div>
      ));
    case 'home':
      return PICS.slice(0, 3).map((p, i) => (
        <div
          key={p}
          className="tm-boardcard tm-loop-pop"
          style={{ left: 16 + i * 86, ...delay(i * 0.15) }}
        >
          <div className={`tm-pic ${p}`} />
          <i className="tm-line" />
        </div>
      ));
  }
}

export function TourMedia({ id }: { id: MediaId }) {
  return (
    <div className={`tm tm--${id}`} aria-hidden="true">
      <Scene id={id} />
    </div>
  );
}
