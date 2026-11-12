// SPDX-License-Identifier: AGPL-3.0-only

import type { FrameElement, PlanElement } from '@inkadra/canvas-core';
import { type AspectRatio, type Element, getBoardAspect } from '@inkadra/doc-schema';
import {
  type Asset,
  type CrewCharacter,
  type CrewMember,
  castNameKey,
  type Person,
  type ScheduleBlock,
  type ShootingDay,
  type ShootingDayInput,
} from '@inkadra/shared';
import { Button, Dialog, DialogActions, Select, Switch } from '@inkadra/ui';
import { Fragment, type ReactNode, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../export/fields.tsx';
import { fetchExportSettings, logoUrl } from '../export/settings.ts';
import { kitList, powerLines } from '../plan/kit.ts';
import { PlanDrawing, type PlanLike } from '../plan/PlanDrawing.tsx';
import {
  asideBlock,
  blockCast,
  dayAddress,
  departmentNotes,
  keyTimes,
  locationsOfDay,
  personalCall,
  serveLines,
  sheetShot,
} from './call-sheet.ts';
import {
  byDepartment,
  castCard,
  castRows,
  dayCrew,
  onSetContacts,
  personalDayCall,
  sunOfDay,
  troupeRows,
} from './day-calls.ts';
import { FramePicture } from './FramePicture.tsx';
import type { NeededRow } from './needed.ts';
import { clockLabel, clockMinutes, scheduleTimes } from './schedule.ts';
import type { BlockLook } from './schedule-sources.tsx';
import { useSlugline } from './storyboard-data.ts';
import './call-sheet.css';
import { useIsPhone } from '../../lib/phone.ts';
import type { BoardStore, Snapshot } from '../store.ts';
import {
  MapsLink,
  PhoneBar,
  PhoneSheetHead,
  PhoneTroupe,
  PresenceActions,
  PresencePanel,
  useAttendance,
} from './CallSheetPhone.tsx';

const emptyElements: Snapshot = {
  byId: new Map<string, Element>(),
  canvas: [],
  columns: new Map(),
  unsorted: [],
};
const emptySnapshot = () => emptyElements;
const noSubscribe = () => () => {};

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
  store?: BoardStore | undefined;
  /**
   * The cards a day's sheet reads, when not the board's own: on the Production board, those of
   * the day's storyboards, the first in tree order winning on a shared name (decision 0123).
   */
  elementsOf?: ((day: ShootingDayInput) => ReadonlyMap<string, Element>) | undefined;
  /** What a block plans, read from its own storyboard, and its name as the calendar says it. */
  look?: ((block: ScheduleBlock) => BlockLook | null) | undefined;
  blockTitle?: ((block: ScheduleBlock) => string) | undefined;
  days: ShootingDay[];
  shots: ReadonlyMap<string, CallSheetShot>;
  projectName?: string | undefined;
  /** The logo of the project's export settings is printed when there is one (decision 0039). */
  projectId?: string | undefined;
  /** Who is looking and on which board: a phone shows their own call and presence with them. */
  boardId?: string | undefined;
  userId?: string | undefined;
  /** Can edit the schedule: on a computer only these people ask for attendance and see it. */
  canManage?: boolean | undefined;
  /** The day shown first, usually the one selected in the schedule. */
  initialDayId?: string | undefined;
  /** Some days have edits that are not saved yet: the sheet only knows the saved plan. */
  unsaved?: boolean;
  /** The scenes of a day with their frames and set plan, in shooting order. */
  scenes?: (day: ShootingDayInput) => SheetScene[];
  /** What the scenes of a day need (decision 0058), and the people who bring it. */
  needed?: (day: ShootingDayInput) => NeededRow[];
  people?: Person[];
  /**
   * The project's crew (decision 0092), for project members only: guests never open this sheet
   * and the client export has no call sheet.
   */
  crew?: CrewMember[] | undefined;
  /** Character cards of other boards that crew rows are linked to. */
  characters?: readonly CrewCharacter[] | undefined;
  /** The project's clock for sunrise and sunset; the device's when none. */
  timeZone?: string | undefined;
  /** A project editor: the presence panel links cast names to accounts through the crew. */
  canLinkCast?: boolean | undefined;
  /** A cast name was linked: the crew changed. */
  onCastLinked?: (() => void) | undefined;
  onClose: () => void;
}
const sections = [
  'troupe',
  'schedule',
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

function useDateLabel(style: 'short' | 'long' | 'phone') {
  const { i18n } = useTranslation();
  return (date: string) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(time)) return date;
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: style === 'long' ? 'long' : 'short',
      day: 'numeric',
      month: style === 'short' ? 'short' : 'long',
      ...(style === 'long' ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(time);
  };
}

export function CallSheetModal({
  store,
  elementsOf,
  look,
  blockTitle,
  days,
  shots,
  projectName,
  projectId,
  boardId,
  userId,
  canManage,
  initialDayId,
  unsaved,
  needed: neededOf,
  scenes: scenesOf,
  people = [],
  crew = [],
  characters = [],
  timeZone,
  canLinkCast,
  onCastLinked,
  onClose,
}: CallSheetModalProps) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? emptySnapshot,
  );
  const slugline = useSlugline();
  const boardAspect = store ? (getBoardAspect(store.doc) ?? '16:9') : '16:9';
  const shortDate = useDateLabel('short');
  const longDate = useDateLabel('long');
  const phoneDate = useDateLabel('phone');
  const isPhone = useIsPhone();
  const attendance = useAttendance(boardId, isPhone || !!canManage);
  const [dayId, setDayId] = useState(initialDayId ?? days[0]?.id ?? '');
  const [included, setIncluded] = useState<Record<Section, boolean>>({
    troupe: true,
    schedule: true,
    cast: true,
    location: true,
    departments: true,
    needed: true,
    notes: true,
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
  const elements = day && elementsOf ? elementsOf(day) : snapshot.byId;
  const slots = day ? scheduleTimes(day) : [];
  const entries = day ? dayCrew(day, crew, elements, characters) : [];
  const calls = day ? castRows(day, entries) : [];
  const troupe = day ? troupeRows(day, entries) : [];
  const contacts = onSetContacts(entries);
  const dayCall = day ? clockMinutes(day.callTime) : 0;
  const departments = day ? departmentNotes(day) : [];
  const times = day ? keyTimes(day) : [];
  const locations = day ? locationsOfDay(day, elements) : [];
  const address = day ? dayAddress(day, elements) : null;
  // The day's own place, with the map link of its Location field, for the phone's map button.
  const dayPlace = day?.location.trim()
    ? locationsOfDay({ ...day, blocks: [] }, elements)[0]
    : undefined;
  const sun = day ? sunOfDay(day, locations, timeZone, address) : null;
  const sunCell = sun && (sun.sunrise !== null || sun.sunset !== null);
  const sunClock = (time: number | null) => (time === null ? '—' : clockLabel(time));
  // Film days name a character per row; a spot names the people themselves.
  const cards = calls.map((call) => castCard(call.name, call.entry, elements, characters));
  // A crew row matched by its role (decision 0092) also makes the row a character.
  const named =
    cards.some(Boolean) ||
    calls.some((c) => c.entry && castNameKey(c.entry.member.name) !== castNameKey(c.name));
  const serve = day ? serveLines(day, elements) : new Map<string, string>();
  const numbered = slots.some(
    ({ block }) =>
      shots.get(block.shotId ?? '')?.scene?.trim() ||
      sheetShot(block, elements).scene?.number?.trim(),
  );
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
    troupe: troupe.length > 0,
    schedule: true,
    cast: calls.length > 0,
    location: locations.length > 0 || !!address,
    departments: departments.length > 0,
    needed: needed.length > 0,
    notes: !!day?.notes.trim(),
    plans: dayScenes.some((s) => s.plan),
  };
  const show = (section: Section) => included[section] && filled[section];
  const shotOf = (shotId: string | null) => (shotId ? shots.get(shotId) : undefined);
  // Both come from the crew row linked to the account (decision 0091): the roster when it can be
  // read, else the attendance links, which the server derives from the same rows.
  const personal = day ? personalDayCall(day, entries, attendance.data?.links, userId) : null;
  const linked = day && attendance.data ? personalCall(day, attendance.data.links, userId) : null;
  const myAnswer = attendance.data?.responses.find(
    (r) => r.dayId === day?.id && r.userId === userId,
  );

  return (
    <div className="phone-sheet">
      <Dialog open title={t('shells.callSheet')} onClose={onClose}>
        {isPhone && (
          <PhoneBar
            title={[t('shells.callSheet'), day && t('schedule.dayNumber', { n: index + 1 })]
              .filter(Boolean)
              .join(' · ')}
            subtitle={day && t('callSheet.revision', { revision: day.revision })}
            onBack={onClose}
          />
        )}
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
            {attendance.loading && (
              <p role="status" className="call-sheet__notice call-sheet__state">
                {t('callSheet.presenceLoading')}
              </p>
            )}
            {attendance.failed && (
              <div className="call-sheet__notice call-sheet__state" role="alert">
                <p>{t('callSheet.presenceError')}</p>
                <Button onClick={attendance.retry}>{t('callSheet.retry')}</Button>
              </div>
            )}
            {day && attendance.data?.canManage && (
              <PresencePanel
                key={day.id}
                day={day}
                data={attendance.data}
                people={people}
                canLink={!!canLinkCast}
                onLink={(name, linkTo) =>
                  attendance.link(name, linkTo).then(() => onCastLinked?.())
                }
              />
            )}
            {isPhone && (
              <Button
                className="call-sheet__print"
                icon="file"
                block
                disabled={!day}
                onClick={() => window.print()}
              >
                {t('shells.print')}
              </Button>
            )}
          </div>
          <div className="call-sheet__preview">
            {day ? (
              <article className="call-sheet__paper ink-paper" aria-label={t('callSheet.preview')}>
                {isPhone && (
                  <PhoneSheetHead
                    project={projectName}
                    date={phoneDate(day.date)}
                    personal={personal}
                  />
                )}
                <header className="sheet__head">
                  <div>
                    <p className="sheet__project">{projectName}</p>
                    <h3 className="sheet__title">{t('shells.callSheet')}</h3>
                  </div>
                  {logo && <img className="sheet__logo" src={logoUrl(logo)} alt="" />}
                </header>
                <dl className={`sheet__facts${contacts.length ? ' sheet__facts--contact' : ''}`}>
                  <Fact label={t('callSheet.day')}>
                    {t('callSheet.dayOf', { n: index + 1, total: ordered.length })}
                  </Fact>
                  <Fact label={t('callSheet.date')}>{longDate(day.date)}</Fact>
                  {contacts.length > 0 && (
                    <Fact label={t('callSheet.onSetContact')}>
                      {contacts.map(({ member }) => (
                        <span key={member.id} className="sheet__contact">
                          <strong>{member.name}</strong>
                          {[member.role.trim(), member.phone.trim()].filter(Boolean).map((part) => (
                            <Fragment key={part}>
                              {' · '}
                              <span className="sheet__nowrap">{part}</span>
                            </Fragment>
                          ))}
                        </span>
                      ))}
                    </Fact>
                  )}
                </dl>
                <dl className="sheet__times" aria-label={t('callSheet.times')}>
                  {times.map(({ key, time }) => (
                    <Fact key={key} label={t(`callSheet.${key}`)} strong>
                      {clockLabel(time)}
                    </Fact>
                  ))}
                  {sun &&
                    sunCell &&
                    (isPhone ? (
                      <>
                        <Fact label={t('callSheet.sunrise')} strong>
                          {sunClock(sun.sunrise)}
                        </Fact>
                        <Fact label={t('callSheet.sunset')} strong>
                          {sunClock(sun.sunset)}
                        </Fact>
                      </>
                    ) : (
                      <Fact
                        label={
                          sun.location
                            ? t('callSheet.sun', { n: sun.location })
                            : t('callSheet.sunAddress')
                        }
                        strong
                        wide
                      >
                        {sunClock(sun.sunrise)} · {sunClock(sun.sunset)}
                      </Fact>
                    ))}
                </dl>
                {show('location') && (
                  <SheetSection title={t('callSheet.location')}>
                    {/* Where the crew goes, when the scenes name their own places (P1). */}
                    {address && (
                      <div className="sheet__location">
                        <p className="sheet__place">
                          <span className="sheet__location-badge">{t('callSheet.address')}</span>{' '}
                          {address.name}
                        </p>
                        {address.address && (
                          <p className="sheet__muted sheet__pre">{address.address}</p>
                        )}
                        {/* On a phone, the same Maps button as the day's place (#577). */}
                        {isPhone && (
                          <MapsLink
                            url={address.mapUrl}
                            location={[address.name, address.address].filter(Boolean).join('\n')}
                          />
                        )}
                        {!isPhone && address.mapUrl && /^https?:\/\//i.test(address.mapUrl) && (
                          <a href={address.mapUrl} target="_blank" rel="noopener noreferrer">
                            {t('story.location.openMap')}
                          </a>
                        )}
                      </div>
                    )}
                    {locations.map((location, n) => (
                      <div key={location.name} className="sheet__location">
                        <p className="sheet__place">
                          <span className="sheet__location-badge">
                            {t('callSheet.locationNumber', { n: n + 1 })}
                          </span>{' '}
                          {location.name}
                        </p>
                        {location.address && (
                          <p className="sheet__muted sheet__pre">{location.address}</p>
                        )}
                        {/* The day's place, unless its own Address line above already opens it. */}
                        {isPhone && !location.mapUrl && dayPlace && !address && (
                          <MapsLink
                            url={dayPlace.mapUrl}
                            location={[dayPlace.name, dayPlace.address].filter(Boolean).join('\n')}
                          />
                        )}
                        {location.mapUrl && /^https?:\/\//i.test(location.mapUrl) && (
                          <a href={location.mapUrl} target="_blank" rel="noopener noreferrer">
                            {t('story.location.openMap')}
                          </a>
                        )}
                      </div>
                    ))}
                  </SheetSection>
                )}
                {show('troupe') && (
                  <SheetSection title={t('callSheet.troupe')}>
                    <table className="sheet__table sheet__table--troupe">
                      <thead>
                        <tr>
                          <th scope="col">{t('callSheet.name')}</th>
                          <th scope="col">{t('troupe.role')}</th>
                          <th scope="col">{t('callSheet.pickup')}</th>
                          <th scope="col">{t('callSheet.callShort')}</th>
                          <th scope="col">{t('troupe.phoneColumn')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byDepartment(troupe).map(({ department, people: members }) => (
                          <Fragment key={department}>
                            <tr className="sheet__group">
                              <th scope="colgroup" colSpan={5}>
                                {department || t('troupe.noDepartment')}
                              </th>
                            </tr>
                            {members.map((person) => (
                              <tr key={person.member.id}>
                                <td>
                                  <strong>{person.member.name}</strong>
                                </td>
                                <td>{person.member.role}</td>
                                <td>{person.pickup.trim() || '—'}</td>
                                <td className="sheet__time">{clockLabel(person.call)}</td>
                                <td>{person.member.phone.trim() || '—'}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                    {isPhone && <PhoneTroupe entries={troupe} userId={userId} />}
                  </SheetSection>
                )}
                {included.schedule && (
                  <SheetSection title={t('callSheet.schedule')}>
                    {slots.length ? (
                      <table
                        className={`sheet__table sheet__table--schedule${numbered ? ' sheet__table--numbered' : ''}`}
                      >
                        <thead>
                          <tr>
                            <th scope="col">{t('callSheet.time')}</th>
                            {numbered && <th scope="col">{t('callSheet.scene')}</th>}
                            <th scope="col">{t('callSheet.shot')}</th>
                            <th scope="col">{t('callSheet.description')}</th>
                            <th scope="col">{t('callSheet.cast')}</th>
                            {locations.length > 1 && <th scope="col">{t('callSheet.place')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map(({ block, start, end }) => {
                            const shot = shotOf(block.shotId);
                            const { frame, scene } = sheetShot(block, elements);
                            const seen = look?.(block);
                            // A scene planned as a whole: its heading, its place, its cast.
                            const whole = block.type === 'scene' && !block.shotId;
                            const heading = scene ? slugline(scene) : '';
                            const locationIndex = locations.findIndex(
                              (loc) =>
                                loc.name.trim().toLocaleLowerCase() ===
                                scene?.location?.trim().toLocaleLowerCase(),
                            );
                            const time = (
                              <td className="sheet__time">
                                {clockLabel(start)}–{clockLabel(end)}
                              </td>
                            );
                            // Breaks, moves and set-ups read as one quiet line across the table.
                            if (asideBlock(block)) {
                              return (
                                <tr
                                  key={block.id}
                                  className={`sheet__row--aside sheet__row--${block.type}`}
                                >
                                  {time}
                                  <td colSpan={(numbered ? 4 : 3) + (locations.length > 1 ? 1 : 0)}>
                                    {[t(`schedule.types.${block.type}`), block.title]
                                      .filter(Boolean)
                                      .join(' · ')}
                                    <BlockNote text={block.notes} />
                                  </td>
                                </tr>
                              );
                            }
                            return (
                              <tr key={block.id} className={`sheet__row--${block.type}`}>
                                {time}
                                {numbered && (
                                  <td className="sheet__scene-number">
                                    {(shot?.scene || scene?.number) && (
                                      <strong>{shot?.scene || scene?.number}</strong>
                                    )}
                                    {(shot?.slugline || heading) && (
                                      <span className="sheet__muted">
                                        {' '}
                                        {shot?.slugline || heading}
                                      </span>
                                    )}
                                  </td>
                                )}
                                <td className="sheet__reference">
                                  {frame && (
                                    <div className="sheet__thumbnail">
                                      <FramePicture
                                        assetId={frame.assetId}
                                        aspect={frame.aspect}
                                        boardAspect={seen?.aspect ?? boardAspect}
                                        strokes={frame.strokes}
                                        shapes={frame.shapes}
                                        referenceOpacity={frame.referenceOpacity}
                                        pixels={180}
                                      />
                                    </div>
                                  )}
                                  <strong>
                                    {whole
                                      ? t('schedule.types.scene')
                                      : block.shotId
                                        ? (shot?.label ??
                                          (seen?.label || t('schedule.missingShot')))
                                        : '—'}
                                  </strong>
                                </td>
                                <td className="sheet__pre">
                                  {whole
                                    ? [blockTitle?.(block) ?? heading, block.title]
                                        .filter(Boolean)
                                        .join('\n')
                                    : shot?.action ||
                                      block.title ||
                                      t(`schedule.types.${block.type}`)}
                                  <BlockNote text={block.notes} />
                                  {serve.get(block.id) && (
                                    <div className="sheet__muted">
                                      {t('callSheet.serve', { items: serve.get(block.id) })}
                                    </div>
                                  )}
                                </td>
                                <td className="sheet__row-cast">
                                  {blockCast(block, elements).join(', ')}
                                </td>
                                {locations.length > 1 && (
                                  <td className="sheet__row-location">
                                    {locationIndex >= 0
                                      ? t('callSheet.locationNumber', { n: locationIndex + 1 })
                                      : ''}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                          {times
                            .filter(({ key }) => key === 'cameraWrap' || key === 'crewWrap')
                            .map(({ key, time }) => (
                              <tr key={key} className="sheet__row--aside">
                                <td className="sheet__time">{clockLabel(time)}</td>
                                <td colSpan={(numbered ? 4 : 3) + (locations.length > 1 ? 1 : 0)}>
                                  {t(`callSheet.${key}`)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="sheet__muted">{t('callSheet.noBlocks')}</p>
                    )}
                  </SheetSection>
                )}
                {show('plans') && (
                  <SheetSection title={t('callSheet.plans')}>
                    {dayScenes
                      .filter((scene) => scene.plan)
                      .map((scene) => (
                        <SheetSceneBlock
                          key={scene.id}
                          scene={scene}
                          plan={show('plans')}
                          options={planOpts}
                        />
                      ))}
                  </SheetSection>
                )}
                {show('cast') && (
                  <SheetSection title={t('callSheet.cast')}>
                    <table className="sheet__table sheet__table--stack">
                      <thead>
                        <tr>
                          <th scope="col">{t(named ? 'callSheet.character' : 'callSheet.name')}</th>
                          <th scope="col">{t('story.character.actor')}</th>
                          <th scope="col">{t('callSheet.pickup')}</th>
                          <th scope="col">{t('callSheet.callShort')}</th>
                          <th scope="col">{t('callSheet.inScene')}</th>
                          <th scope="col">{t('callSheet.contact')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calls.map(({ name, start, entry }, i) => {
                          const card = cards[i];
                          const actor =
                            card?.actor ||
                            (entry && castNameKey(entry.member.name) !== castNameKey(name)
                              ? entry.member.name
                              : '');
                          const pickup = entry?.pickup.trim() ?? '';
                          return (
                            <tr key={name}>
                              <td>
                                <strong>{name}</strong>
                              </td>
                              <td>{actor}</td>
                              <td
                                className={pickup ? undefined : 'sheet__cell--none'}
                                data-label={t('callSheet.pickup')}
                              >
                                {pickup || '—'}
                              </td>
                              <td className="sheet__time" data-label={t('callSheet.callShort')}>
                                {clockLabel(entry?.call ?? dayCall)}
                              </td>
                              <td className="sheet__time" data-label={t('callSheet.inScene')}>
                                {clockLabel(start)}
                              </td>
                              <td>{card?.contact || entry?.member.phone}</td>
                            </tr>
                          );
                        })}
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
                    <table className="sheet__table sheet__table--stack sheet__table--needed">
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
                            <td data-label={t('callSheet.scenes')}>
                              {/* An unnumbered scene reads "—" in the schedule; here it is left out. */}
                              {row.scenes.filter((scene) => scene !== '—').join(', ')}
                            </td>
                            <td
                              className={
                                row.assigneeId ? undefined : 'sheet__muted sheet__cell--none'
                              }
                              data-label={t('callSheet.bringer')}
                            >
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
        {!isPhone && (
          <DialogActions>
            <Button onClick={onClose}>{t('shells.close')}</Button>
            <Button variant="primary" icon="file" disabled={!day} onClick={() => window.print()}>
              {t('shells.print')}
            </Button>
          </DialogActions>
        )}
        {isPhone && day && linked && (
          <PresenceActions
            key={day.id}
            status={myAnswer?.status ?? null}
            onAnswer={(status) => attendance.answer(day.id, status)}
          />
        )}
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
  wide,
  children,
}: {
  label: string;
  strong?: boolean;
  /** Two columns of the key times, so "07:21 · 16:44" stays on one line. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`sheet__fact${wide ? ' sheet__fact--wide' : ''}`}>
      <dt>{label}</dt>
      <dd className={strong ? 'sheet__fact-strong' : undefined}>{children}</dd>
    </div>
  );
}

/** A block's own note, printed as a highlighted line under its description. */
function BlockNote({ text }: { text?: string | undefined }) {
  const note = text?.trim();
  return note ? <div className="sheet__note sheet__pre">{note}</div> : null;
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
  plan?: (PlanLike & Partial<Pick<PlanElement, 'circuits' | 'voltage'>>) | undefined;
  boardAspect: AspectRatio;
}

function SheetSceneBlock({
  scene,
  plan,
  options,
}: {
  scene: SheetScene;
  plan: boolean;
  options: { kit: boolean; moves: boolean; fullPage: boolean };
}) {
  const { t, i18n } = useTranslation();
  const kit = scene.plan && options.kit ? kitList(scene.plan, t, i18n.language) : [];
  // The power per circuit with the kit (decision 0111): computed from the plan, never stored.
  const power = scene.plan && options.kit ? powerLines(scene.plan, t, i18n.language) : null;
  return (
    <div className={`sheet__scene${plan && options.fullPage ? ' sheet__scene--page' : ''}`}>
      <p className="sheet__scene-head">
        <b>{scene.title}</b> {scene.heading}
      </p>
      <div className="sheet__scene-plan-body">
        {plan && scene.plan && (
          <div className="sheet__scene-plan">
            <div className="plan">
              <PlanDrawing plan={scene.plan} moves={options.moves} />
            </div>
            {kit.length > 0 && (
              <ul className="sheet__kit">
                {kit.map((k) => (
                  <li key={k.key}>
                    {k.name} ×{k.count}
                  </li>
                ))}
              </ul>
            )}
            {power && (
              <div className="sheet__power">
                <p className="sheet__power-head">
                  <b>{power.title}</b> <span>{power.total}</span>
                </p>
                <ul className="sheet__power-list">
                  {power.rows.map((r) => (
                    <li key={r.text}>
                      {r.text} · {r.amps}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
