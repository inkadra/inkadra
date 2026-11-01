// SPDX-License-Identifier: AGPL-3.0-only

import type { FrameElement } from '@inkadra/canvas-core';
import type { AspectRatio } from '@inkadra/doc-schema';
import type { Asset, Person, ShootingDay, ShootingDayInput } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Select, Switch } from '@inkadra/ui';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../export/fields.tsx';
import { fetchExportSettings, logoUrl } from '../export/settings.ts';
import { kitList } from '../plan/kit.ts';
import { PlanDrawing, type PlanLike } from '../plan/PlanDrawing.tsx';
import { castCalls, departmentNotes, plannedWrap } from './call-sheet.ts';
import { FramePicture } from './FramePicture.tsx';
import type { NeededRow } from './needed.ts';
import { clockLabel, scheduleTimes } from './schedule.ts';
import './call-sheet.css';
import { formatClock } from '../../lib/datetime.ts';

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
  /** The scenes of a day with their frames and set plan, in shooting order. */
  scenes?: (day: ShootingDayInput) => SheetScene[];
  /** What the scenes of a day need (decision 0058), and the people who bring it. */
  needed?: (day: ShootingDayInput) => NeededRow[];
  people?: Person[];
  onClose: () => void;
}
const sections = [
  'schedule',
  'frames',
  'plans',
  'cast',
  'location',
  'departments',
  'needed',
  'notes',
] as const;
/** Options of the set plans on the sheet (#335 round 6, i). */
const planOptions = ['kit', 'moves', 'fullPage'] as const;
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
  needed: neededOf,
  scenes: scenesOf,
  people = [],
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
    needed: true,
    notes: true,
    frames: true,
    plans: true,
  });
  const [planOpts, setPlanOpts] = useState({ kit: true, moves: false, fullPage: false });
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
  const needed = day && neededOf ? neededOf(day) : [];
  const dayScenes = day && scenesOf ? scenesOf(day) : [];
  // "Giulia R.": a sheet column is narrow.
  const bringer = (row: NeededRow) => {
    const [first = '', ...rest] = (people.find((p) => p.id === row.assigneeId)?.name ?? '')
      .trim()
      .split(/\s+/);
    return [first, rest.at(-1) && `${rest.at(-1)?.[0]}.`].filter(Boolean).join(' ');
  };
  // A section with nothing to print is left out of the sheet and says so in its row.
  const filled: Record<Section, boolean> = {
    schedule: true,
    cast: calls.length > 0,
    location: !!day?.location.trim(),
    departments: departments.length > 0,
    needed: needed.length > 0,
    notes: !!day?.notes.trim(),
    frames: dayScenes.some((s) => s.frames.length > 0),
    plans: dayScenes.some((s) => s.plan),
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
                <Select
                  id={id}
                  className="ink-input"
                  value={day?.id ?? ''}
                  disabled={!day}
                  onChange={(e) => setDayId(e)}
                >
                  {ordered.map((item, n) => (
                    <option key={item.id} value={item.id}>
                      {[t('schedule.dayNumber', { n: n + 1 }), shortDate(item.date)].join(' · ')}
                    </option>
                  ))}
                </Select>
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
                  badge={section === 'plans' ? t('callSheet.new') : undefined}
                />
              ))}
              {show('plans') &&
                planOptions.map((option) => (
                  <ToggleRow
                    key={option}
                    nested
                    label={t(`callSheet.${option}`)}
                    help={option === 'kit' ? t('callSheet.kitHelp') : undefined}
                    checked={planOpts[option]}
                    disabled={false}
                    onChange={(checked) => setPlanOpts((o) => ({ ...o, [option]: checked }))}
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
                    {formatClock(day.callTime)}
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
                {(show('frames') || show('plans')) && (
                  <SheetSection title={t('callSheet.scenes')}>
                    {dayScenes.map((scene) => (
                      <SheetSceneBlock
                        key={scene.id}
                        scene={scene}
                        frames={show('frames')}
                        plan={show('plans')}
                        options={planOpts}
                      />
                    ))}
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
                {show('needed') && (
                  <SheetSection title={t('callSheet.needed')}>
                    <table className="sheet__table">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="ink-sr-only">{t('callSheet.check')}</span>
                          </th>
                          <th scope="col">{t('callSheet.item')}</th>
                          <th scope="col">{t('callSheet.type')}</th>
                          <th scope="col">{t('callSheet.scenes')}</th>
                          <th scope="col">{t('callSheet.bringer')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* The boxes stay empty on paper: they are ticked by hand on set. */}
                        {needed.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <span className="sheet__box" />
                            </td>
                            <td>
                              {row.text}
                              {row.count > 1 && ` ×${row.count}`}
                            </td>
                            <td>{t(`board.todo.lists.${row.list}`)}</td>
                            <td>{row.scenes.join(', ')}</td>
                            <td className={row.assigneeId ? undefined : 'sheet__muted'}>
                              {bringer(row) || '—'}
                            </td>
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
  badge,
  nested,
}: {
  label: string;
  help?: string | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  badge?: string | undefined;
  nested?: boolean;
}) {
  const id = useId();
  return (
    <div className={`call-sheet__row${nested ? ' call-sheet__row--nested' : ''}`}>
      <label className="call-sheet__row-text" htmlFor={id}>
        <span className="call-sheet__row-label">
          {label}
          {badge && <span className="call-sheet__badge">{badge}</span>}
        </span>
        {help && <span className="call-sheet__row-help">{help}</span>}
      </label>
      <Switch
        id={id}
        aria-checked={checked}
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

/** A scene of the day on the sheet, with its frames and its set plan. */
export interface SheetScene {
  id: string;
  /** "Sc. 5". */
  title: string;
  /** "INT. CUCINA – GIORNO". */
  heading: string;
  frames: ReadonlyArray<{ id: string; label: string; frame: FrameElement }>;
  plan?: PlanLike | undefined;
  boardAspect: AspectRatio;
}

function SheetSceneBlock({
  scene,
  frames,
  plan,
  options,
}: {
  scene: SheetScene;
  frames: boolean;
  plan: boolean;
  options: { kit: boolean; moves: boolean; fullPage: boolean };
}) {
  const { t, i18n } = useTranslation();
  const kit = scene.plan && options.kit ? kitList(scene.plan, t, i18n.language) : [];
  return (
    <div className={`sheet__scene${plan && options.fullPage ? ' sheet__scene--page' : ''}`}>
      <p className="sheet__scene-head">
        <b>{scene.title}</b> {scene.heading}
      </p>
      <div className="sheet__scene-body">
        {frames && scene.frames.length > 0 && (
          <div className="sheet__scene-frames">
            {scene.frames.map((f) => (
              <figure key={f.id}>
                <FramePicture
                  assetId={f.frame.assetId}
                  aspect={f.frame.aspect}
                  boardAspect={scene.boardAspect}
                  strokes={f.frame.strokes}
                  shapes={f.frame.shapes}
                  referenceOpacity={f.frame.referenceOpacity}
                  pixels={360}
                />
                <figcaption>{f.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {plan && scene.plan && (
          <div className="sheet__scene-plan">
            <div className="plan">
              <PlanDrawing plan={scene.plan} moves={options.moves} />
            </div>
            {kit.length > 0 && (
              <ul className="sheet__kit">
                {kit.map((k) => (
                  <li key={k.name}>
                    {k.name} ×{k.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
