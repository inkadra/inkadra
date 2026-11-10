// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import { castNameKey, type ShootingDayInput } from '@inkadra/shared';
import { Button, Checkbox, EmptyState } from '@inkadra/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { keyTimes } from './call-sheet.ts';
import {
  byDepartment,
  type CrewState,
  characterName,
  type DayCrewEntry,
  dayCrew,
  withDayCall,
} from './day-calls.ts';
import { AutoTime } from './fields.tsx';
import type { CalendarDay } from './ScheduleCalendar.tsx';
import { clockLabel, clockMinutes } from './schedule.ts';

/**
 * The "Convocazioni" tab of the day panel (decision 0092): who is called and only the
 * exceptions to the day's call. Edits are drafts of the day, saved and undone like the others.
 */
export function DayCallsPanel({
  entry,
  crew,
  elements,
  readOnly,
  blockLabel,
  onChange,
  onOpenTroupe,
}: {
  entry: CalendarDay;
  crew: CrewState;
  elements: ReadonlyMap<string, Element>;
  readOnly: boolean;
  blockLabel: (blockId: string) => string;
  onChange: (next: ShootingDayInput, key?: string) => void;
  onOpenTroupe?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { draft, stale } = entry;
  if (crew.failed)
    return (
      <p className="schedule__hint" role="status">
        {t('dayCalls.unavailable')}
      </p>
    );
  if (!crew.items)
    return (
      <p className="schedule__hint" role="status">
        {t('troupe.loading')}
      </p>
    );
  if (!crew.items.length)
    return (
      <EmptyState
        icon="people"
        title={t('dayCalls.emptyTitle')}
        actions={
          onOpenTroupe && (
            <Button icon="people" onClick={onOpenTroupe}>
              {t('dayCalls.openTroupe')}
            </Button>
          )
        }
      >
        {t('dayCalls.emptyBody')}
      </EmptyState>
    );
  const entries = dayCrew(draft, crew.items, elements, crew.characters);
  const change = (person: DayCrewEntry, patch: Parameters<typeof withDayCall>[2], key?: string) =>
    onChange(
      {
        ...draft,
        calls: withDayCall(
          draft.calls,
          person,
          patch,
          entries.map((entry) => entry.member),
        ),
      },
      key,
    );
  const dayCall = clockLabel(clockMinutes(draft.callTime));
  const absent = entries.filter((e) => !e.called);
  const row = (person: DayCrewEntry) => {
    const { member } = person;
    const rowId = `${id}-${member.id}`;
    const detail = characterName(member, elements, crew.characters) || member.role.trim();
    return (
      <div key={member.id} className="day-calls__row" data-called={person.called}>
        <Checkbox
          checked={person.called}
          aria-label={t('dayCalls.calledToday', { name: member.name })}
          onChange={(e) => change(person, { called: e.target.checked })}
        />
        <span className="day-calls__name">
          {member.name}
          {detail && <small> · {detail}</small>}
        </span>
        {person.called && (
          <>
            <label className="ink-sr-only" htmlFor={`${rowId}-call`}>
              {t('dayCalls.callOf', { name: member.name })}
            </label>
            <AutoTime
              key={member.id}
              id={`${rowId}-call`}
              value={person.ownCall}
              computed={dayCall}
              autoLabel={t('schedule.auto')}
              disabled={readOnly || stale}
              onChange={(call) => change(person, { call }, `call:${member.id}`)}
            />
            <input
              className="ink-input"
              aria-label={t('dayCalls.pickupOf', { name: member.name })}
              maxLength={1000}
              value={person.ownPickup ?? ''}
              placeholder={member.pickup.trim() || t('dayCalls.pickup')}
              onChange={(e) => change(person, { pickup: e.target.value }, `pickup:${member.id}`)}
            />
          </>
        )}
        {person.called && person.cast && person.scene && (
          <span className="day-calls__hint">
            {blockLabel(person.scene.blockId)
              ? t('dayCalls.inScene', {
                  time: clockLabel(person.scene.start),
                  block: blockLabel(person.scene.blockId),
                })
              : t('dayCalls.inSceneAt', { time: clockLabel(person.scene.start) })}
          </span>
        )}
      </div>
    );
  };
  return (
    <div className="day-calls">
      <dl className="day-calls__times" aria-label={t('dayCalls.times')}>
        {keyTimes(draft).map(({ key, time }) => (
          <div key={key} className="day-calls__time">
            <dt>{t(`callSheet.${key}`)}</dt>
            <dd>{clockLabel(time)}</dd>
          </div>
        ))}
      </dl>
      <p className="schedule__hint">{t('dayCalls.hint')}</p>
      <fieldset className="day-calls__list" disabled={readOnly || stale}>
        <legend className="ink-sr-only">{t('dayCalls.title')}</legend>
        {byDepartment(entries.filter((e) => e.called)).map(({ department, people }) => (
          <section key={department} aria-label={department || t('troupe.noDepartment')}>
            <h3 className="day-calls__group">
              {department || t('troupe.noDepartment')}
              {castNameKey(department) === 'cast' && (
                <small> · {t('dayCalls.castOnlyScheduled')}</small>
              )}
            </h3>
            {people.map(row)}
          </section>
        ))}
        {absent.length > 0 && (
          <details className="day-calls__more">
            <summary>
              {t('dayCalls.notCalled', {
                count: absent.length,
                names: absent.map((e) => e.member.name).join(', '),
              })}
            </summary>
            {absent.map(row)}
          </details>
        )}
      </fieldset>
    </div>
  );
}
