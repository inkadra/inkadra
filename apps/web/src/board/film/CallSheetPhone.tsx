// SPDX-License-Identifier: AGPL-3.0-only

import {
  type AttendanceStatus,
  castNameKey,
  type DayAttendance,
  type Person,
  type ScheduleAttendance,
  type ShootingDayInput,
} from '@inkadra/shared';
import { Button, DialogActions, Icon, IconButton, Select } from '@inkadra/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.ts';
import { openInMapsUrl } from '../maps.ts';
import { castCalls, type SheetRow } from './call-sheet.ts';
import { clockLabel } from './schedule.ts';

/** Cast links and presence of a board's schedule; nothing is asked of the server when off. */
export function useAttendance(boardId: string | undefined, enabled: boolean) {
  const [data, setData] = useState<ScheduleAttendance | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const path = `/boards/${boardId}/schedule`;
  const on = enabled && !!boardId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks for the data again.
  useEffect(() => {
    if (!on) return;
    let live = true;
    setFailed(false);
    api.get<ScheduleAttendance>(`${path}/attendance`).then(
      (next) => live && setData(next),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [on, path, attempt]);
  const answer = useCallback(
    async (dayId: string, status: AttendanceStatus) => {
      const saved = await api.put<DayAttendance>(`${path}/${dayId}/attendance`, { status });
      setData(
        (current) =>
          current && {
            ...current,
            responses: [
              ...current.responses.filter((r) => r.dayId !== dayId || r.userId !== saved.userId),
              saved,
            ],
          },
      );
    },
    [path],
  );
  const link = useCallback(
    async (name: string, userId: string | null) => {
      await api.put(`${path}/cast-links`, { name, userId });
      const castKey = castNameKey(name);
      setData(
        (current) =>
          current && {
            ...current,
            links: [
              ...current.links.filter((l) => l.castKey !== castKey),
              ...(userId ? [{ castKey, userId }] : []),
            ],
          },
      );
    },
    [path],
  );
  return {
    data,
    loading: on && !data && !failed,
    failed: on && failed,
    retry: () => setAttempt((n) => n + 1),
    answer,
    link,
  };
}

/** The phone's top bar, in place of the dialog's title (which stays for screen readers). */
export function PhoneBar({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string | undefined;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="call-sheet__bar">
      <IconButton icon="chevronLeft" label={t('shells.close')} onClick={onBack} />
      <div className="call-sheet__bar-text" aria-hidden="true">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
      </div>
    </header>
  );
}

/** Top of the paper: project and date, the general call and, for a linked person, their own. */
export function PhoneSheetHead({
  project,
  date,
  call,
  wrap,
  personal,
}: {
  project?: string | undefined;
  date: string;
  call: string;
  wrap: string;
  personal: { name: string; start: number } | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="sheet__phone-head">
      <div className="sheet__phone-line">
        <span className="sheet__label">{project}</span>
        <b className="sheet__phone-date">{date}</b>
      </div>
      <div className="sheet__phone-line">
        <div>
          <div className="sheet__label">{t('callSheet.general')}</div>
          <b className="sheet__phone-call">{call}</b>
          <div className="sheet__muted">
            {t('callSheet.wrap')} {wrap}
          </div>
        </div>
        {personal && (
          <div className="sheet__phone-own">
            <div className="sheet__label">{t('callSheet.yourCall')}</div>
            <b>
              {personal.name} · {clockLabel(personal.start)}
            </b>
          </div>
        )}
      </div>
    </div>
  );
}

/** Nothing leaves the phone until the link is tapped: the address goes in its URL only. */
export function MapsLink({ location }: { location: string }) {
  const { t } = useTranslation();
  const href = openInMapsUrl({
    name: '',
    address: location
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(', '),
  });
  if (!href) return null;
  return (
    <a
      className="ink-btn ink-btn--secondary sheet__maps"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <Icon name="pin" size={14} />
      {t('board.map.open')}
    </a>
  );
}

/** The day's schedule at a glance: time, scene and shots, who is in them. */
export function PhoneSchedule({ rows }: { rows: SheetRow[] }) {
  const { t } = useTranslation();
  const text = ({ block, scene, first, last }: SheetRow) => {
    if (!first) {
      if (block.shotId) return t('schedule.missingShot');
      return block.title || t(`schedule.types.${block.type}`);
    }
    const shots = last ? `${first}–${last}` : first;
    return scene ? `${t('needed.sceneNumber', { number: scene })} · ${shots}` : shots;
  };
  return (
    <table className="sheet__rows">
      <thead className="ink-sr-only">
        <tr>
          <th scope="col">{t('callSheet.time')}</th>
          <th scope="col">{t('callSheet.shot')}</th>
          <th scope="col">{t('callSheet.cast')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          row.block.type !== 'shot' && !row.block.shotId ? (
            <tr key={row.id} className="sheet__muted">
              <td>{clockLabel(row.start)}</td>
              <td colSpan={2}>
                {[t(`schedule.types.${row.block.type}`), row.block.title]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          ) : (
            <tr key={row.id}>
              <td>
                <b>{clockLabel(row.start)}</b>
              </td>
              <td className={row.first ? 'sheet__rows-shots' : undefined}>{text(row)}</td>
              <td>{row.block.cast.join(', ')}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/** Confirm or decline: only for someone linked to a name called on this day. */
export function PresenceActions({
  status,
  onAnswer,
}: {
  status: AttendanceStatus | null;
  onAnswer: (status: AttendanceStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const choose = (next: AttendanceStatus) => {
    setSaving(true);
    setFailed(false);
    onAnswer(next)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <DialogActions>
      <div className="call-sheet__answer">
        {/* Always there, empty or not: a live region only announces changes it was present for. */}
        <p role="status">{!failed && status ? t(`callSheet.answer.${status}`) : ''}</p>
        {failed && <p role="alert">{t('callSheet.saveError')}</p>}
      </div>
      <div className="call-sheet__answers">
        <Button
          variant="primary"
          aria-pressed={status === 'confirmed'}
          {...(status === 'confirmed' ? { icon: 'check' as const } : {})}
          disabled={saving}
          onClick={() => choose('confirmed')}
        >
          {t('callSheet.confirm')}
        </Button>
        <Button
          variant={status === 'declined' ? 'secondary' : 'ghost'}
          aria-pressed={status === 'declined'}
          {...(status === 'declined' ? { icon: 'check' as const } : {})}
          disabled={saving}
          onClick={() => choose('declined')}
        >
          {t('callSheet.decline')}
        </Button>
      </div>
    </DialogActions>
  );
}

/** Which account a cast name belongs to; waits for its request before the next choice. */
function PersonSelect({
  name,
  userId,
  people,
  onLink,
}: {
  name: string;
  userId: string | undefined;
  people: Person[];
  onLink: (name: string, userId: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  // A disabled control drops the keyboard's focus: give it back unless it has moved on.
  useEffect(() => {
    if (pending || !hadFocus.current) return;
    hadFocus.current = false;
    box.current?.querySelector('button')?.focus();
  }, [pending]);
  return (
    <div ref={box} className="call-sheet__person">
      <Select
        aria-label={t('callSheet.linkAccount', { name })}
        value={userId ?? ''}
        disabled={pending}
        onChange={(next) => {
          if (next === (userId ?? '')) return;
          setPending(true);
          onLink(name, next || null).finally(() => {
            const focused = document.activeElement;
            hadFocus.current = focused === document.body || !!box.current?.contains(focused);
            setPending(false);
          });
        }}
      >
        <option value="">{t('callSheet.noAccount')}</option>
        {/* Linked to someone the list does not show, such as a person with a grant on the board. */}
        {userId && !people.some((person) => person.id === userId) && (
          <option value={userId}>{t('callSheet.otherAccount')}</option>
        )}
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * For organisers, on a phone and on a computer: who of the day's cast answered, and which account
 * each name belongs to.
 * shortcut: the choice lists project members, not people with a grant on this board only;
 * extend it if those turn out to be cast too.
 */
export function PresencePanel({
  day,
  data,
  people,
  onLink,
}: {
  day: ShootingDayInput & { id: string };
  data: ScheduleAttendance;
  people: Person[];
  onLink: (name: string, userId: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [failed, setFailed] = useState(false);
  const calls = castCalls(day);
  if (!calls.length) return null;
  const statusOf = (userId?: string) =>
    data.responses.find((r) => r.dayId === day.id && r.userId === userId)?.status;
  const rows = calls.map((call) => {
    const userId = data.links.find((l) => l.castKey === castNameKey(call.name))?.userId;
    return { ...call, userId, status: statusOf(userId) };
  });
  // One person can play two names: the count is of people, not of rows.
  const linked = [...new Set(rows.flatMap((row) => row.userId ?? []))];
  return (
    <section className="call-sheet__group call-sheet__presence" aria-labelledby={titleId}>
      <h3 id={titleId} className="call-sheet__group-title">
        {t('callSheet.presence')}
        {linked.length > 0 &&
          ` · ${t('callSheet.presenceCount', {
            confirmed: linked.filter((userId) => statusOf(userId) === 'confirmed').length,
            total: linked.length,
          })}`}
      </h3>
      {failed && (
        <p role="alert" className="call-sheet__notice">
          {t('callSheet.saveError')}
        </p>
      )}
      {rows.map((row) => (
        <div key={row.name} className="call-sheet__row">
          <div className="call-sheet__row-text">
            <span className="call-sheet__row-label">{row.name}</span>
            <span className={`call-sheet__row-help is-${row.status ?? 'none'}`}>
              {clockLabel(row.start)}
              {row.userId && ` · ${t(`callSheet.status.${row.status ?? 'waiting'}`)}`}
            </span>
          </div>
          <PersonSelect
            name={row.name}
            userId={row.userId}
            people={people}
            onLink={(name, userId) => {
              setFailed(false);
              return onLink(name, userId).catch(() => setFailed(true));
            }}
          />
        </div>
      ))}
    </section>
  );
}
