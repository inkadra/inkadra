import { Icon } from '@inkadra/ui';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { formatDateTime } from '../lib/datetime.ts';
import { preferencesLoaded, updatePreferences, usePreferences } from '../lib/preferences.ts';
import { usePendingUpdate, useUpdates } from '../lib/updates.ts';
import { useAboveChrome } from '../tutorial/Pill.tsx';
import './update-popup.css';

/**
 * "Inkadra X.Y.Z is available" (#515): administrators only, bottom right, never in the way of
 * work, once per version per person (`updateSeen`). The notification stays in the Inbox.
 */
export function UpdatePopup() {
  const release = usePendingUpdate();
  const { data } = useUpdates();
  const { updateSeen } = usePreferences();
  const { pathname, search } = useLocation();
  // The cached preferences of another device could show it once more: wait for the account.
  if (!release || !data || !preferencesLoaded() || updateSeen === release.version) return null;
  if (pathname === '/onboarding' || new URLSearchParams(search).get('section') === 'updates')
    return null;
  if (!shows()) return null;
  return <Card key={release.version} />;
}

/**
 * Browsers driven by tests (`navigator.webdriver`) get no pop-up unless the page asks with
 * `inkadra.updates = on`, as with the tutorials, so the end-to-end suites keep their screens.
 */
function shows(): boolean {
  try {
    if (localStorage.getItem('inkadra.updates') === 'on') return true;
  } catch {
    // No storage: decide on the browser alone.
  }
  return !navigator.webdriver;
}

function Card() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const release = usePendingUpdate();
  const { data } = useUpdates();
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const descId = useId();
  useAboveChrome(ref);
  if (!release || !data) return null;
  const seen = (skip = false) =>
    void updatePreferences({
      updateSeen: release.version,
      ...(skip && { updateSkipped: release.version }),
    }).catch(() => {});
  const date = release.publishedAt
    ? formatDateTime(release.publishedAt, { day: 'numeric', month: 'short' })
    : null;
  return (
    <section
      ref={ref}
      className="update-popup ink-motion-rise"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-chrome
      onKeyDown={(e) => {
        if (e.key === 'Escape') seen();
      }}
    >
      <header className="update-popup__head">
        <span className="update-popup__icon" aria-hidden="true">
          <Icon name="upload" size={14} />
        </span>
        <div className="update-popup__text">
          <h2 id={titleId} className="update-popup__title">
            {t('updates.popupTitle', { version: release.version })}
          </h2>
          <p id={descId} className="update-popup__meta">
            {[
              t(release.prerelease ? 'updates.preview' : 'updates.stable'),
              date && t('updates.releasedShort', { date }),
              t('updates.runningShort', { version: data.current }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <button
          type="button"
          className="ink-iconbtn update-popup__close"
          aria-label={t('updates.close')}
          data-ink-tooltip={t('updates.close')}
          onClick={() => seen()}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      {release.highlights.length > 0 && (
        <ul className="update-popup__news">
          {release.highlights.slice(0, 4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {release.beforeUpdating.length > 0 && (
        <p className="update-popup__warn">
          <Icon name="warning" size={13} />
          {t('updates.toRead', { count: release.beforeUpdating.length })}
        </p>
      )}
      <footer className="update-popup__actions">
        <button type="button" className="ink-btn ink-btn--ghost" onClick={() => seen(true)}>
          {t('updates.skip')}
        </button>
        <span className="update-popup__go">
          <a
            className="ink-btn ink-btn--secondary"
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => seen()}
          >
            {t('updates.github')}
          </a>
          <button
            type="button"
            className="ink-btn ink-btn--primary"
            onClick={() => {
              seen();
              navigate('/settings?section=updates');
            }}
          >
            {t('updates.seeNews')}
          </button>
        </span>
      </footer>
    </section>
  );
}
