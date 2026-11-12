import { Button, Icon, IconButton, kindStyle, Switch, toolStyle } from '@inkadra/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { updatePreferences, usePreferences } from '../lib/preferences.ts';
import { useSession } from '../lib/session.tsx';
import { trackSave } from '../routes/settings-save.ts';
import { Badge, Card, Row, Summary } from '../routes/settings-ui.tsx';
import { requestTour, resetSeen } from './state.ts';
import { GROUPS, type Tour, toursFor, WELCOME } from './tours.ts';
import './tutorial.css';

/** Settings → Tutorial (#502): replay every tour, see what is new, hints, start over. */
export function TutorialSettings() {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const admin = user?.role === 'admin';
  const prefs = usePreferences();
  const hintsId = useId();
  const tours = toursFor(admin, !!instance?.demo, prefs.modulesOff);
  const seen = new Set(prefs.tutorialsSeen);
  const total = tours.length + 1;
  const count = [WELCOME, ...tours].filter((tour) => seen.has(tour.id)).length;
  const row = (tour: Tour) => {
    const name = t(`tutorial.tours.${tour.id}.name`);
    const done = seen.has(tour.id);
    return (
      <Row
        key={tour.id}
        leading={
          <span
            className="settings-tile"
            style={tour.kind ? kindStyle(tour.kind) : tour.tool ? toolStyle(tour.tool) : undefined}
            aria-hidden="true"
          >
            <Icon name={tour.icon} size={16} />
          </span>
        }
        label={name}
        help={
          <span className={`tour-state${done ? ' is-seen' : ''}`}>
            {done ? (
              <>
                <Icon name="check" size={11} />
                {t('tutorial.settings.seen')}
              </>
            ) : (
              <>
                <span className="tour-state__dot" aria-hidden="true" />
                {t('tutorial.settings.unseen')}
              </>
            )}
            {' · '}
            {t('tutorial.settings.duration')}
          </span>
        }
      >
        <IconButton
          icon="play"
          label={t('tutorial.settings.playNamed', { name })}
          onClick={() => requestTour(tour.id)}
        />
      </Row>
    );
  };
  return (
    <>
      <Summary
        tone="accent"
        icon="play"
        live
        title={
          <>
            {t('tutorial.settings.count', { seen: count, total })}
            {count < total && <Badge tone="accent">{t('tutorial.settings.new')}</Badge>}
          </>
        }
        text={`${t('tutorial.settings.welcomeTitle')} · ${t('tutorial.settings.welcomeSub')}`}
        action={
          <Button variant="primary" icon="play" onClick={() => requestTour(WELCOME.id)}>
            {t('tutorial.settings.play')}
          </Button>
        }
        meter={
          <span className="settings-meter" aria-hidden="true">
            <i style={{ width: `${(count / total) * 100}%` }} />
          </span>
        }
      />
      {GROUPS.filter((group) => tours.some((tour) => tour.group === group)).map((group) => (
        <Card
          key={group}
          title={t(`tutorial.groups.${group}`)}
          action={group === 'admin' && <Badge>{t('tutorial.settings.adminOnly')}</Badge>}
        >
          {tours.filter((tour) => tour.group === group).map(row)}
        </Card>
      ))}
      <Card title={t('tutorial.settings.prefs')}>
        <Row
          label={t('tutorial.settings.hints')}
          help={t('tutorial.settings.hintsHelp')}
          htmlFor={hintsId}
        >
          <Switch
            id={hintsId}
            checked={prefs.tutorialHints}
            onChange={(e) =>
              void trackSave(updatePreferences({ tutorialHints: e.target.checked })).catch(() => {})
            }
          />
        </Row>
        <Row label={t('tutorial.settings.reset')} help={t('tutorial.settings.resetHelp')}>
          <Button onClick={resetSeen}>{t('tutorial.settings.resetAction')}</Button>
        </Row>
      </Card>
    </>
  );
}
