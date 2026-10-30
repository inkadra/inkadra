// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset, ShootingDay } from '@inkadra/shared';
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../export/fields.tsx';
import { fetchExportSettings, logoUrl } from '../export/settings.ts';
import { castCalls, departmentNotes, plannedWrap } from './call-sheet.ts';
import { clockLabel, scheduleTimes } from './schedule.ts';
import './call-sheet.css';

/** What the sheet prints for a shot: its label, what happens in it and its scene. */
export interface CallSheetShot {
  label: string;
  action?: string | undefined;
  /** Scene number, e.g. "12". */
  scene?: string | undefined;
  /** INT. PLATFORM – NIGHT. */
  slugline?: string | undefined;
}

export interface CallSheetModalProps {
  days: ShootingDay[];
  shots: ReadonlyMap<string, CallSheetShot>;
  projectName?: string | undefined;
  /** The logo of the project's export settings is printed when there is one (decision 0039). */
  projectId?: string | undefined;
  /** The day shown first, usually the one selected in the schedule. */
  initialDayId?: string | undefined;
  /** Some days have edits that are not saved yet: the sheet only knows the saved plan. */
  unsaved?: boolean;
  onClose: () => void;
}
const sections = ['schedule', 'cast', 'location', 'departments', 'notes'] as const;
type Section = (typeof sections)[number];

function useDateLabel(style: 'short' | 'long') {
  const { i18n } = useTranslation();
  return (date: string) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(time)) return date;
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: style,
      day: 'numeric',
      month: style,
      ...(style === 'long' ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(time);
  };
}

export function CallSheetModal({
  days,
  shots,
  projectName,
  projectId,
  initialDayId,
  unsaved,
  onClose,
}: CallSheetModalProps) {
  const { t } = useTranslation();
  const shortDate = useDateLabel('short');
  const longDate = useDateLabel('long');
  const [dayId, setDayId] = useState(initialDayId ?? days[0]?.id ?? '');
  const [included, setIncluded] = useState<Record<Section, boolean>>({
    schedule: true,
    cast: true,
    location: true,
    departments: true,
    notes: true,
  });
  const groupId = useId();
  const [logo, setLogo] = useState<Asset | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetchExportSettings(projectId).then(
      (settings) => live && setLogo(settings.logo),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const ordered = [...days].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const index = Math.max(
    0,
    ordered.findIndex((item) => item.id === dayId),
  );
  const day = ordered[index];
  const slots = day ? scheduleTimes(day) : [];
  const calls = day ? castCalls(day) : [];
  const departments = day ? departmentNotes(day) : [];
  const wrap = day ? plannedWrap(day) : null;
  // A section with nothing to print is left out of the sheet and says so in its row.
  const filled: Record<Section, boolean> = {
    schedule: true,
    cast: calls.length > 0,
    location: !!day?.location.trim(),
    departments: departments.length > 0,
    notes: !!day?.notes.trim(),
  };
  const show = (section: Section) => included[section] && filled[section];
  const shotOf = (shotId: string | null) => (shotId ? shots.get(shotId) : undefined);
  const shotsOf = (name: string) => {
    const key = name.toLocaleLowerCase();
    return slots
      .filter(({ block }) => block.cast.some((value) => value.trim().toLocaleLowerCase() === key))
      .map(({ block }) => shotOf(block.shotId)?.label)
      .filter(Boolean)
      .join(', ');
  };
  const [place = '', ...address] = (day?.location ?? '').trim().split('\n');

  return (
    <div className="phone-sheet">
      <Dialog open title={t('shells.callSheet')} onClose={onClose}>
        <div className="call-sheet">
          <div className="call-sheet__controls">
            <Field label={t('schedule.date')}>
              {(id) => (
                <select
                  id={id}
                  className="ink-input"
                  value={day?.id ?? ''}
                  disabled={!day}
                  onChange={(e) => setDayId(e.target.value)}
                >
                  {ordered.map((item, n) => (
                    <option key={item.id} value={item.id}>
                      {[t('schedule.dayNumber', { n: n + 1 }), shortDate(item.date)].join(' · ')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <section className="call-sheet__group" aria-labelledby={groupId}>
              <h3 id={groupId} className="call-sheet__group-title">
                {t('callSheet.sections')}
              </h3>
              {sections.map((section) => (
                <ToggleRow
                  key={section}
                  label={t(`callSheet.${section}`)}
                  help={
                    day && !filled[section]
                      ? t('callSheet.emptyHelp')
                      : section === 'cast'
                        ? t('callSheet.castHelp')
                        : undefined
                  }
                  checked={show(section)}
                  disabled={!day || !filled[section]}
                  onChange={(checked) =>
                    setIncluded((current) => ({ ...current, [section]: checked }))
                  }
                />
              ))}
            </section>
            {unsaved && <p className="call-sheet__notice">{t('callSheet.unsaved')}</p>}
          </div>
          <div className="call-sheet__preview">
            {day ? (
              <article className="call-sheet__paper ink-paper" aria-label={t('callSheet.preview')}>
                <header className="sheet__head">
                  <div>
                    <p className="sheet__project">{projectName}</p>
                    <h3 className="sheet__title">{t('shells.callSheet')}</h3>
                  </div>
                  {logo && <img className="sheet__logo" src={logoUrl(logo)} alt="" />}
                </header>
                <dl className="sheet__facts">
                  <Fact label={t('callSheet.day')}>
                    {t('callSheet.dayOf', { n: index + 1, total: ordered.length })}
                  </Fact>
                  <Fact label={t('callSheet.date')}>{longDate(day.date)}</Fact>
                  <Fact label={t('callSheet.call')} strong>
                    {day.callTime}
                  </Fact>
                  <Fact label={t('callSheet.wrap')} strong>
                    {wrap === null ? '—' : clockLabel(wrap)}
                  </Fact>
                </dl>
                {show('location') && (
                  <SheetSection title={t('callSheet.location')}>
                    <p className="sheet__place">{place}</p>
                    {address.length > 0 && (
                      <p className="sheet__muted sheet__pre">{address.join('\n')}</p>
                    )}
                  </SheetSection>
                )}
                {included.schedule && (
                  <SheetSection title={t('callSheet.schedule')}>
                    {slots.length ? (
                      <table className="sheet__table sheet__table--schedule">
                        <thead>
                          <tr>
                            <th scope="col">{t('callSheet.time')}</th>
                            <th scope="col">{t('callSheet.scene')}</th>
                            <th scope="col">{t('callSheet.shot')}</th>
                            <th scope="col">{t('callSheet.description')}</th>
                            <th scope="col">{t('callSheet.cast')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map(({ block, start, end }) => {
                            const shot = shotOf(block.shotId);
                            const time = (
                              <td className="sheet__time">
                                {clockLabel(start)}–{clockLabel(end)}
                              </td>
                            );
                            // Breaks, moves and set-ups read as one quiet line across the table.
                            if (block.type !== 'shot' && !block.shotId) {
                              return (
                                <tr key={block.id} className="sheet__row--aside">
                                  {time}
                                  <td colSpan={4}>
                                    {[t(`schedule.types.${block.type}`), block.title]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </td>
                                </tr>
                              );
                            }
                            return (
                              <tr key={block.id}>
                                {time}
                                <td>
                                  {shot?.scene && <strong>{shot.scene}</strong>}
                                  {shot?.slugline && (
                                    <span className="sheet__muted"> {shot.slugline}</span>
                                  )}
                                </td>
                                <td>
                                  <strong>
                                    {block.shotId
                                      ? (shot?.label ?? t('schedule.missingShot'))
                                      : '—'}
                                  </strong>
                                </td>
                                <td className="sheet__pre">
                                  {shot?.action || block.title || t(`schedule.types.${block.type}`)}
                                </td>
                                <td>{block.cast.join(', ')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="sheet__muted">{t('callSheet.noBlocks')}</p>
                    )}
                  </SheetSection>
                )}
                {show('cast') && (
                  <SheetSection title={t('callSheet.cast')}>
                    <table className="sheet__table">
                      <thead>
                        <tr>
                          <th scope="col">{t('callSheet.name')}</th>
                          <th scope="col">{t('callSheet.firstBlock')}</th>
                          <th scope="col">{t('callSheet.shots')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calls.map((call) => (
                          <tr key={call.name}>
                            <td>
                              <strong>{call.name}</strong>
                            </td>
                            <td className="sheet__time">{clockLabel(call.start)}</td>
                            <td>{shotsOf(call.name)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </SheetSection>
                )}
                {show('departments') && (
                  <SheetSection title={t('callSheet.departments')}>
                    <table className="sheet__table">
                      <thead>
                        <tr>
                          <th scope="col">{t('callSheet.department')}</th>
                          <th scope="col">{t('callSheet.time')}</th>
                          <th scope="col">{t('callSheet.note')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((entry) => (
                          <tr key={`${entry.blockId}-${entry.department}-${entry.note}`}>
                            <td>
                              <strong>{entry.department}</strong>
                            </td>
                            <td className="sheet__time">{clockLabel(entry.start)}</td>
                            <td className="sheet__pre">{entry.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </SheetSection>
                )}
                {show('notes') && (
                  <SheetSection title={t('callSheet.notes')}>
                    <p className="sheet__pre">{day.notes.trim()}</p>
                  </SheetSection>
                )}
                <footer className="sheet__foot">
                  <span>{t('callSheet.revision', { revision: day.revision })}</span>
                  <span>{t('export.madeWith')}</span>
                </footer>
              </article>
            ) : (
              <p role="status" className="call-sheet__empty">
                {t('schedule.empty')}
              </p>
            )}
          </div>
        </div>
        <DialogActions>
          <Button onClick={onClose}>{t('shells.close')}</Button>
          <Button variant="primary" icon="file" disabled={!day} onClick={() => window.print()}>
            {t('shells.print')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** A section switch in the style of the settings rows: label and short help, control on the right. */
function ToggleRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: string | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="call-sheet__row">
      <label className="call-sheet__row-text" htmlFor={id}>
        <span className="call-sheet__row-label">{label}</span>
        {help && <span className="call-sheet__row-help">{help}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="call-sheet__switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function Fact({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="sheet__fact">
      <dt>{label}</dt>
      <dd className={strong ? 'sheet__fact-strong' : undefined}>{children}</dd>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sheet__section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}
