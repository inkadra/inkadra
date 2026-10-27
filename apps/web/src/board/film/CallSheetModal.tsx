// SPDX-License-Identifier: AGPL-3.0-only
import type { ShootingDay } from '@inkadra/shared';
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { castCalls } from './call-sheet.ts';
import { clockLabel, clockMinutes, scheduleTimes } from './schedule.ts';
import './call-sheet.css';

export interface CallSheetModalProps {
  days: ShootingDay[];
  labels: ReadonlyMap<string, string>;
  projectName?: string;
  onClose: () => void;
}
const sections = ['schedule', 'cast', 'location', 'departments', 'notes'] as const;
type Section = (typeof sections)[number];
const unavailable = ['weather', 'map', 'hospital', 'contacts', 'thumbnails'] as const;

export function CallSheetModal({ days, labels, projectName, onClose }: CallSheetModalProps) {
  const { t } = useTranslation();
  const [dayId, setDayId] = useState(days[0]?.id ?? '');
  const [included, setIncluded] = useState<Record<Section, boolean>>({
    schedule: true,
    cast: true,
    location: true,
    departments: true,
    notes: true,
  });
  const ordered = [...days].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const day = ordered.find((item) => item.id === dayId) ?? ordered[0];
  const slots = day ? scheduleTimes(day) : [];
  const calls = day ? castCalls(day) : [];
  const departmentSlots = slots.filter(({ block }) => block.departments.length);
  const empty = t('callSheet.empty');
  return (
    <Dialog open title={t('shells.callSheet')} onClose={onClose}>
      <div className="call-sheet">
        <aside className="call-sheet__controls">
          <label>
            {t('schedule.date')}
            <select
              value={day?.id ?? ''}
              disabled={!day}
              onChange={(e) => setDayId(e.target.value)}
            >
              {ordered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.date}
                </option>
              ))}
            </select>
          </label>
          <p>{t('callSheet.savedOnly')}</p>
          <fieldset>
            <legend>{t('callSheet.include')}</legend>
            {sections.map((section) => (
              <label key={section}>
                <input
                  type="checkbox"
                  checked={included[section]}
                  onChange={(e) =>
                    setIncluded((current) => ({ ...current, [section]: e.target.checked }))
                  }
                />
                {t(`callSheet.${section}`)}
              </label>
            ))}
            {unavailable.map((section) => (
              <label key={section}>
                <input type="checkbox" disabled checked={false} />
                {t(`callSheet.${section}`)} · {t('callSheet.unavailable')}
              </label>
            ))}
          </fieldset>
        </aside>
        {day ? (
          <article className="call-sheet__paper" aria-label={t('callSheet.preview')}>
            <header>
              <h3>{projectName}</h3>
              <h4>{t('shells.callSheet')}</h4>
              <p>
                {day.date} · {t('callSheet.revision', { revision: day.revision })}
              </p>
            </header>
            <dl>
              <dt>{t('schedule.callTime')}</dt>
              <dd>{day.callTime}</dd>
              <dt>{t('schedule.wrap')}</dt>
              <dd>
                {day.wrap
                  ? clockLabel(
                      clockMinutes(day.wrap) +
                        (clockMinutes(day.wrap) < clockMinutes(day.callTime) ? 1440 : 0),
                    )
                  : empty}
              </dd>
            </dl>
            {included.location && (
              <section>
                <h4>{t('callSheet.location')}</h4>
                <p>{day.location || empty}</p>
              </section>
            )}
            {included.schedule && (
              <section>
                <h4>{t('callSheet.schedule')}</h4>
                {slots.length ? (
                  <table>
                    <thead>
                      <tr>
                        {['time', 'description', 'shot', 'cast'].map((key) => (
                          <th scope="col" key={key}>
                            {t(`callSheet.${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map(({ block, start, end }) => (
                        <tr key={block.id}>
                          <td>
                            {clockLabel(start)} – {clockLabel(end)}
                          </td>
                          <td>
                            {t(`schedule.types.${block.type}`)}
                            {block.title && ` · ${block.title}`}
                          </td>
                          <td>
                            {block.shotId
                              ? (labels.get(block.shotId) ?? t('schedule.missingShot'))
                              : '—'}
                          </td>
                          <td>{block.cast.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>{empty}</p>
                )}
              </section>
            )}
            {included.cast && (
              <section>
                <h4>{t('callSheet.cast')}</h4>
                <p>{t('callSheet.derivedCalls')}</p>
                {calls.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t('schedule.cast')}</th>
                        <th scope="col">{t('callSheet.firstBlock')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((call) => (
                        <tr key={call.name}>
                          <td>{call.name}</td>
                          <td>{clockLabel(call.start)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>{empty}</p>
                )}
              </section>
            )}
            {included.departments && (
              <section>
                <h4>{t('callSheet.departments')}</h4>
                {departmentSlots.length ? (
                  <ul>
                    {departmentSlots.map(({ block, start }) => (
                      <li key={block.id}>
                        <strong>{block.departments.join(', ')}</strong> · {clockLabel(start)} ·{' '}
                        {block.title || t(`schedule.types.${block.type}`)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{empty}</p>
                )}
              </section>
            )}
            {included.notes && (
              <section>
                <h4>{t('schedule.notes')}</h4>
                <p>{day.notes || empty}</p>
              </section>
            )}
          </article>
        ) : (
          <p role="status">{t('schedule.empty')}</p>
        )}
      </div>
      <DialogActions>
        <Button onClick={onClose}>{t('shells.close')}</Button>
        <Button disabled={!day} onClick={() => window.print()}>
          {t('shells.print')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
