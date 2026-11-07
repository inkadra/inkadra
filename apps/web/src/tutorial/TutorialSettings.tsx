import { Button, Icon, kindStyle, Switch, toolStyle } from '@inkadra/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { updatePreferences, usePreferences } from '../lib/preferences.ts';
import { useSession } from '../lib/session.tsx';
import { trackSave } from '../routes/settings-save.ts';
import { Badge, Card, Row } from '../routes/settings-ui.tsx';
import { requestTour, resetSeen } from './state.ts';
import { GROUPS, type Tour, toursFor, WELCOME } from './tours.ts';
import './tutorial.css';

/** Settings → Tutorial (#502): replay every tour, see what is new, hints, start over. */
export function TutorialSettings() {
  const { t } = useTranslation();
  const { user } = useSession();
  const admin = user?.role === 'admin';
  const prefs = usePreferences();
  const hintsId = useId();
  const tours = toursFor(admin);
  const seen = new Set(prefs.tutorialsSeen);
  const total = tours.length + 1;
  const count = [WELCOME, ...tours].filter((tour) => seen.has(tour.id)).length;
  const tile = (tour: Tour) => {
    const name = t(`tutorial.tours.${tour.id}.name`);
    const done = seen.has(tour.id);
    return (
      <li key={tour.id} className="tour-tile">
        <span
          className="tour-tile__icon"
          style={tour.kind ? kindStyle(tour.kind) : tour.tool ? toolStyle(tour.tool) : undefined}
        >
          <Icon name={tour.icon} size={16} />
        </span>
        <span className="tour-tile__text">
          <span className="tour-tile__name">{name}</span>
          <span className={`tour-tile__state${done ? ' is-seen' : ''}`}>
            {done ? (
              <>
                <Icon name="check" size={11} />
                {t('tutorial.settings.seen')}
              </>
            ) : (
              <>
                <span className="tour-tile__dot" aria-hidden="true" />
                {t('tutorial.settings.unseen')}
              </>
            )}
            <span className="tour-tile__time"> · {t('tutorial.settings.duration')}</span>
          </span>
        </span>
        <button
          type="button"
          className="ink-iconbtn tour-tile__play"
          aria-label={t('tutorial.settings.playNamed', { name })}
          data-ink-tooltip={t('tutorial.settings.playNamed', { name })}
          onClick={() => requestTour(tour.id)}
        >
          <Icon name="play" size={12} />
        </button>
      </li>
    );
  };
  return (
    <div className="tour-settings">
      <p className="tour-settings__count" role="status">
        {count < total && <Badge tone="accent">{t('tutorial.settings.new')}</Badge>}
        {t('tutorial.settings.count', { seen: count, total })}
      </p>
      <Card>
        <div className="tour-settings__welcome">
          <span className="tour-settings__welcome-icon" aria-hidden="true">
            <Icon name="star" size={16} />
          </span>
          <span className="tour-tile__text">
            <span className="tour-tile__name">{t('tutorial.settings.welcomeTitle')}</span>
            <span className="settings-row__help">{t('tutorial.settings.welcomeSub')}</span>
          </span>
          <Button variant="primary" icon="play" onClick={() => requestTour(WELCOME.id)}>
            {t('tutorial.settings.play')}
          </Button>
        </div>
      </Card>
      {GROUPS.filter((group) => tours.some((tour) => tour.group === group)).map((group) => (
        <section
          key={group}
          className="tour-settings__group"
          aria-labelledby={`tour-group-${group}`}
        >
          <h3 id={`tour-group-${group}`}>
            {t(`tutorial.groups.${group}`)}
            {group === 'admin' && <Badge>{t('tutorial.settings.adminOnly')}</Badge>}
          </h3>
          <ul className="tour-settings__grid">
            {tours.filter((tour) => tour.group === group).map(tile)}
          </ul>
        </section>
      ))}
      <Card>
        <div className="settings-rows">
          <Row
            label={t('tutorial.settings.hints')}
            help={t('tutorial.settings.hintsHelp')}
            htmlFor={hintsId}
          >
            <Switch
              id={hintsId}
              checked={prefs.tutorialHints}
              onChange={(e) =>
                void trackSave(updatePreferences({ tutorialHints: e.target.checked })).catch(
                  () => {},
                )
              }
            />
          </Row>
          <Row label={t('tutorial.settings.reset')} help={t('tutorial.settings.resetHelp')}>
            <Button onClick={resetSeen}>{t('tutorial.settings.resetAction')}</Button>
          </Row>
        </div>
      </Card>
    </div>
  );
}
