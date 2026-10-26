// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement } from '@inkadra/canvas-core';
import {
  ShootingDayInput as DaySchema,
  type Schedule,
  type ScheduleBlock,
  type ShootingDay,
  type ShootingDayInput,
} from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import type { BoardStore } from '../store.ts';
import { CallSheetModal } from './CallSheetModal.tsx';
import { useStoryboard } from './StoryboardView.tsx';
import {
  castConflicts,
  clockLabel,
  newScheduleBlock,
  scheduleTimes,
  textList,
} from './schedule.ts';
import './film.css';

export const SHOT_DRAG_TYPE = 'application/x-inkadra-schedule-shot';
export function resolveDroppedShot(
  payload: string,
  boardId: string,
  ids: readonly string[],
  readOnly: boolean,
): string | null {
  if (readOnly) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('boardId' in value) ||
      !('shotId' in value)
    )
      return null;
    return value.boardId === boardId &&
      typeof value.shotId === 'string' &&
      ids.includes(value.shotId)
      ? value.shotId
      : null;
  } catch {
    return null;
  }
}

export function ScheduleView({
  store,
  projectName,
  boardId = '',
  readOnly = false,
}: {
  store: BoardStore;
  boardTitle?: string;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { frames, labels } = useStoryboard(store);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [days, setDays] = useState<ShootingDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const path = `/boards/${boardId}/schedule`;
  useEffect(() => {
    void generation; // Explicit reload invalidates the fetched snapshot.
    let active = true;
    setLoading(true);
    setDays([]);
    api
      .get<Schedule>(path)
      .then((data) => {
        if (active) {
          setDays(data.items);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError(t('schedule.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, generation, t]);

  async function write(action: () => Promise<void>) {
    if (busy || readOnly) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(
        t(
          err instanceof RequestError && err.status === 409
            ? 'schedule.conflict'
            : 'schedule.saveError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const save = (day: ShootingDay, draft: ShootingDayInput) =>
    write(async () => {
      const saved = await api.put<ShootingDay>(`${path}/${day.id}`, {
        ...draft,
        revision: day.revision,
      });
      setDays((current) =>
        current
          .map((item) => (item.id === day.id ? saved : item))
          .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
      );
    });
  const scheduled = new Set(days.flatMap((day) => day.blocks.map((block) => block.shotId)));
  return (
    <section className="film-shell schedule" aria-label={t('nav.schedule')}>
      <header>
        <h1>{t('nav.schedule')}</h1>
        <Button onClick={() => setCallSheetOpen(true)}>{t('shells.callSheet')}</Button>
        {!readOnly && (
          <Button
            disabled={busy || loading}
            onClick={() =>
              write(async () => {
                const day = await api.post<ShootingDay>(path, {
                  date: new Date().toLocaleDateString('en-CA'),
                  callTime: '08:00',
                  wrap: null,
                  location: '',
                  notes: '',
                  blocks: [],
                });
                setDays((current) => [...current, day]);
              })
            }
          >
            {t('schedule.addDay')}
          </Button>
        )}
        <Button disabled={busy} onClick={() => setGeneration((g) => g + 1)}>
          {t('schedule.reload')}
        </Button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">{t('schedule.loading')}</p>
      ) : (
        <div className="film-shell__columns">
          <section className="schedule__queue" aria-label={t('schedule.queue')}>
            <h2>{t('schedule.queue')}</h2>
            {frames
              .filter((frame) => !scheduled.has(frame.id))
              .map((frame) => (
                <button
                  type="button"
                  disabled={readOnly || busy}
                  key={frame.id}
                  className="film-shell__card"
                  draggable={!readOnly && !busy}
                  onDragStart={(event) => {
                    if (readOnly || busy) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData(
                      SHOT_DRAG_TYPE,
                      JSON.stringify({ boardId, shotId: frame.id }),
                    );
                  }}
                >
                  {labels.get(frame.id)} · {frame.action}
                </button>
              ))}
            {!frames.length && <p>{t('shells.noShots')}</p>}
          </section>
          <div className="schedule__days">
            {!days.length && <p>{t('schedule.empty')}</p>}
            {days.map((day) => (
              <DayEditor
                key={`${day.id}:${day.revision}`}
                day={day}
                days={days}
                frames={frames}
                labels={labels}
                boardId={boardId}
                readOnly={readOnly}
                busy={busy}
                onSave={(draft) => save(day, draft)}
                onDelete={() =>
                  write(async () => {
                    await api.delete(`${path}/${day.id}`, { revision: day.revision });
                    setDays((current) => current.filter((item) => item.id !== day.id));
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
      {callSheetOpen && (
        <CallSheetModal projectName={projectName} onClose={() => setCallSheetOpen(false)} />
      )}
    </section>
  );
}

function DayEditor({
  day,
  days,
  frames,
  labels,
  boardId,
  readOnly,
  busy,
  onSave,
  onDelete,
}: {
  day: ShootingDay;
  days: ShootingDay[];
  frames: FrameElement[];
  labels: Map<string, string>;
  boardId: string;
  readOnly: boolean;
  busy: boolean;
  onSave: (draft: ShootingDayInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ShootingDayInput>(() =>
    DaySchema.parse({
      date: day.date,
      callTime: day.callTime,
      wrap: day.wrap,
      location: day.location,
      notes: day.notes,
      blocks: day.blocks,
    }),
  );
  const [selectedShot, setSelectedShot] = useState('');
  const disabled = readOnly || busy;
  const valid = DaySchema.safeParse(draft).success;
  const conflicts = castConflicts(days.map((item) => (item.id === day.id ? draft : item)));
  const update = (patch: Partial<ShootingDayInput>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const blockUpdate = (id: string, patch: Partial<ScheduleBlock>) =>
    update({
      blocks: draft.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    });
  const addShot = (shotId: string) => {
    if (
      disabled ||
      !valid ||
      days.some((item) => item.blocks.some((block) => block.shotId === shotId)) ||
      draft.blocks.some((block) => block.shotId === shotId)
    )
      return;
    const frame = frames.find((item) => item.id === shotId);
    if (!frame) return;
    const block = { ...newScheduleBlock('shot', shotId), cast: frame.cast ?? [] };
    const next = { ...draft, blocks: [...draft.blocks, block] };
    setDraft(next);
    void onSave(next);
  };
  const move = (index: number, offset: number) => {
    const blocks = [...draft.blocks];
    const [block] = blocks.splice(index, 1);
    if (block) blocks.splice(index + offset, 0, block);
    update({ blocks });
  };
  return (
    <section
      className="schedule__day"
      aria-label={t('schedule.day', { date: day.date })}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const id = resolveDroppedShot(
          event.dataTransfer.getData(SHOT_DRAG_TYPE),
          boardId,
          frames.map((frame) => frame.id),
          disabled,
        );
        if (id) addShot(id);
      }}
    >
      <h2>{t('schedule.day', { date: draft.date })}</h2>
      <fieldset disabled={disabled}>
        <div className="schedule__fields">
          <label>
            {t('schedule.date')}
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          </label>
          <label>
            {t('schedule.callTime')}
            <input
              type="time"
              required
              value={draft.callTime}
              onChange={(e) => update({ callTime: e.target.value })}
            />
          </label>
          <label>
            {t('schedule.wrap')}
            <input
              type="time"
              value={draft.wrap ?? ''}
              onChange={(e) => update({ wrap: e.target.value || null })}
            />
          </label>
          <label>
            {t('schedule.location')}
            <input
              maxLength={1000}
              value={draft.location}
              onChange={(e) => update({ location: e.target.value })}
            />
          </label>
        </div>
        <label>
          {t('schedule.notes')}
          <textarea
            maxLength={10000}
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
        {scheduleTimes(draft).map(({ block, start, end }, index) => (
          <article key={block.id} className="schedule__block">
            <strong>
              {clockLabel(start)} – {clockLabel(end)}
            </strong>
            {block.shotId && (
              <p>
                {labels.get(block.shotId) ?? t('schedule.missingShot')} ·{' '}
                {frames.find((frame) => frame.id === block.shotId)?.action}
              </p>
            )}
            <div className="schedule__fields">
              <label>
                {t('schedule.type')}
                <select
                  value={block.type}
                  onChange={(e) =>
                    blockUpdate(block.id, { type: e.target.value as ScheduleBlock['type'] })
                  }
                >
                  {(['setup', 'shot', 'break', 'move', 'note'] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(`schedule.types.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('schedule.title')}
                <input
                  maxLength={500}
                  value={block.title}
                  onChange={(e) => blockUpdate(block.id, { title: e.target.value })}
                />
              </label>
              <label>
                {t('schedule.start')}
                <input
                  type="time"
                  value={block.start ?? ''}
                  onChange={(e) => blockUpdate(block.id, { start: e.target.value || null })}
                />
              </label>
              <label>
                {t('schedule.duration')}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={block.duration}
                  onChange={(e) => blockUpdate(block.id, { duration: Number(e.target.value) })}
                />
              </label>
              <label>
                {t('schedule.cast')}
                <input
                  defaultValue={block.cast.join(', ')}
                  onBlur={(e) => blockUpdate(block.id, { cast: textList(e.target.value) })}
                />
              </label>
              <label>
                {t('schedule.departments')}
                <input
                  defaultValue={block.departments.join(', ')}
                  onBlur={(e) => blockUpdate(block.id, { departments: textList(e.target.value) })}
                />
              </label>
            </div>
            {conflicts.has(block.id) && <p role="status">{t('schedule.castConflict')}</p>}
            {!readOnly && (
              <div className="schedule__actions">
                <Button disabled={busy || index === 0} onClick={() => move(index, -1)}>
                  {t('schedule.up')}
                </Button>
                <Button
                  disabled={busy || index === draft.blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  {t('schedule.down')}
                </Button>
                <Button
                  onClick={() =>
                    update({ blocks: draft.blocks.filter((item) => item.id !== block.id) })
                  }
                >
                  {t('schedule.removeBlock')}
                </Button>
              </div>
            )}
          </article>
        ))}
        {!readOnly && (
          <div className="schedule__actions">
            <Button
              onClick={() => update({ blocks: [...draft.blocks, newScheduleBlock('setup')] })}
            >
              {t('schedule.addBlock')}
            </Button>
            <select
              aria-label={t('schedule.selectShot')}
              value={selectedShot}
              onChange={(e) => setSelectedShot(e.target.value)}
            >
              <option value="">{t('schedule.selectShot')}</option>
              {frames
                .filter(
                  (frame) =>
                    !days.some((item) => item.blocks.some((block) => block.shotId === frame.id)) &&
                    !draft.blocks.some((block) => block.shotId === frame.id),
                )
                .map((frame) => (
                  <option key={frame.id} value={frame.id}>
                    {labels.get(frame.id)} · {frame.action}
                  </option>
                ))}
            </select>
            <Button disabled={!selectedShot || !valid} onClick={() => addShot(selectedShot)}>
              {t('schedule.addShot')}
            </Button>
            <Button disabled={!valid} onClick={() => onSave(draft)}>
              {t('schedule.save')}
            </Button>
            <Button onClick={onDelete}>{t('schedule.deleteDay')}</Button>
          </div>
        )}
      </fieldset>
      {!draft.blocks.length && <p>{t('shells.dropShot')}</p>}
    </section>
  );
}
