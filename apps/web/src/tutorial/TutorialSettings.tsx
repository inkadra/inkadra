import { Button, EmptyState, Icon, kindStyle, Switch, toolStyle } from '@inkadra/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updatePreferences, usePreferences } from '../lib/preferences.ts';
import { useSession } from '../lib/session.tsx';
import { trackSave } from '../routes/settings-save.ts';
import { Badge, Card, Row, Segmented, Summary } from '../routes/settings-ui.tsx';
import { requestTour, resetSeen } from './state.ts';
import { GROUPS, type Tour, toursFor, WELCOME } from './tours.ts';
import './tutorial.css';

export type TourFilter = 'all' | 'unseen';

/** The groups of tours to list, in order, each with how many of its tours were seen. */
export function tourGroups(tours: Tour[], seen: Set<string>, filter: TourFilter) {
  return GROUPS.map((group) => {
    const all = tours.filter((tour) => tour.group === group);
    return {
      group,
      total: all.length,
      seen: all.filter((tour) => seen.has(tour.id)).length,
      tours: filter === 'unseen' ? all.filter((tour) => !seen.has(tour.id)) : all,
    };
  }).filter((group) => group.tours.length > 0);
}

/** Settings → Tutorial (#502): replay every tour, see what is new, hints, start over. */
export function TutorialSettings() {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const admin = user?.role === 'admin';
  const prefs = usePreferences();
  const hintsId = useId();
  const stateId = useId();
  const [filter, setFilter] = useState<TourFilter>('all');
  const tours = toursFor(admin, !!instance?.demo, prefs.modulesOff);
  const seen = new Set(prefs.tutorialsSeen);
  const total = tours.length + 1;
  const count = [WELCOME, ...tours].filter((tour) => seen.has(tour.id)).length;
  const unseen = tours.filter((tour) => !seen.has(tour.id)).length;
  const groups = tourGroups(tours, seen, filter);
  const tile = (tour: Tour) => {
    const name = t(`tutorial.tours.${tour.id}.name`);
    const done = seen.has(tour.id);
    return (
      <button
        key={tour.id}
        type="button"
        className={`tour-tile${done ? '' : ' is-unseen'}`}
        aria-label={t('tutorial.settings.playNamed', { name })}
        aria-describedby={`${stateId}-${tour.id}`}
        onClick={() => requestTour(tour.id)}
      >
        <span
          className="settings-tile"
          style={tour.kind ? kindStyle(tour.kind) : tour.tool ? toolStyle(tour.tool) : undefined}
          aria-hidden="true"
        >
          <Icon name={tour.icon} size={16} />
        </span>
        <span className="tour-tile__text">
          <span className="tour-tile__name">{name}</span>
          <span id={`${stateId}-${tour.id}`} className={`tour-state${done ? ' is-seen' : ''}`}>
            {done && <Icon name="check" size={11} />}
            {t(done ? 'tutorial.settings.seen' : 'tutorial.settings.unseen')}
            {' · '}
            {t('tutorial.settings.duration')}
          </span>
        </span>
        <span className="tour-tile__play" aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
      </button>
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
          <span className="space-meter space-meter--small tour-meter" aria-hidden="true">
            <span style={{ width: `${(count / total) * 100}%` }} />
          </span>
        }
      />
      <Segmented
        className="tour-filter"
        label={t('tutorial.settings.filter')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: <FilterLabel text={t('tutorial.settings.all')} n={tours.length} /> },
          {
            value: 'unseen',
            label: <FilterLabel text={t('tutorial.settings.unseen')} n={unseen} />,
          },
        ]}
      />
      {groups.length === 0 && (
        <EmptyState icon="check" title={t('tutorial.settings.allSeen')}>
          {t('tutorial.settings.allSeenHelp')}
        </EmptyState>
      )}
      {groups.map(({ group, total, seen, tours }) => (
        <Card
          key={group}
          className="tour-group"
          title={t(`tutorial.groups.${group}`)}
          action={
            <>
              {group === 'admin' && <Badge>{t('tutorial.settings.adminOnly')}</Badge>}
              <span className="settings-card__meta">
                {t('tutorial.settings.groupCount', { seen, total })}
              </span>
            </>
          }
        >
          {tours.map(tile)}
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

function FilterLabel({ text, n }: { text: string; n: number }) {
  return (
    <>
      {text} <span className="tour-filter__count">{n}</span>
    </>
  );
}
