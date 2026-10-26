// SPDX-License-Identifier: AGPL-3.0-only
import {
  addFrame,
  addScene,
  type FrameElement,
  formatDuration,
  totalDurationMs,
  updateElement,
} from '@inkadra/canvas-core';
import {
  FRAME_STATUSES,
  type FrameStatus,
  SHOT_ANGLES,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
} from '@inkadra/doc-schema';
import { Button, EmptyState, Icon } from '@inkadra/ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardReview } from '../CardReview.tsx';
import { GuestVisibility } from '../guest-visibility.tsx';
import { type BoardStore, LOCAL } from '../store.ts';
import { useBoardAspect } from './aspect.ts';
import { DrawingEditor } from './DrawingEditor.tsx';
import { FramePanel } from './FramePanel.tsx';
import { FramePicture } from './FramePicture.tsx';
import { FrameVisibilityButton } from './FrameVisibilityButton.tsx';
import {
  blurOnEnter,
  PresetField,
  parseSeconds,
  StatusSelect,
  secondsText,
  usePresetText,
} from './fields.tsx';
import { ShotlistKanban } from './ShotlistKanban.tsx';
import { useSlugline, useStoryboard } from './StoryboardView.tsx';

type Patch = Partial<Omit<FrameElement, 'id' | 'type'>>;

/** The shot list: the same frames as the storyboard, as a table or kanban. */
export function ShotList({
  store,
  boardTitle,
  projectId = '',
  boardId = '',
  userId = 'local',
  readOnly,
}: {
  store: BoardStore;
  boardTitle: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const { groups, frames, labels } = useStoryboard(store);
  const slugline = useSlugline();
  const presetText = usePresetText();
  const [mode, setMode] = useState<'table' | 'kanban'>('table');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FrameStatus | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);

  const opts = useMemo(() => ({ userId, origin: LOCAL }), [userId]);
  const currentFrame = frames.find((f) => f.id === selected) ?? null;
  const drawn = frames.find((f) => f.id === drawing) ?? null;
  const drawnAt = drawn ? frames.indexOf(drawn) : -1;

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (f: FrameElement) =>
      (!status || (f.status ?? 'draft') === status) &&
      (!q ||
        [
          labels.get(f.id),
          f.action,
          f.dialogue,
          f.notes,
          f.location,
          f.lens,
          presetText('film.shot', SHOT_SIZES, f.shot),
          presetText('film.angle', SHOT_ANGLES, f.angle),
          presetText('film.movement', SHOT_MOVEMENTS, f.movement),
          ...(f.cast ?? []),
          ...(f.tags ?? []),
        ].some((v) => v?.toLowerCase().includes(q))),
    [status, q, labels, presetText],
  );

  const shown = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, frames: g.frames.filter(matches) }))
        .filter((g) => g.frames.length > 0),
    [groups, matches],
  );

  const allFilteredFrames = useMemo(() => frames.filter(matches), [frames, matches]);

  const set = (id: string, patch: Patch) => !readOnly && updateElement(store.doc, id, patch, LOCAL);

  const addFrameInStatus = (targetStatus: FrameStatus) => {
    if (readOnly) return;
    store.undo.stopCapturing();
    let sceneId = groups[0]?.scene?.id ?? null;
    if (!sceneId) {
      const s = addScene(store.doc, {}, opts);
      sceneId = s.id;
    }
    const f = addFrame(
      store.doc,
      sceneId,
      null,
      { status: targetStatus === 'todo' ? undefined : targetStatus },
      opts,
    );
    setSelected(f.id);
  };

  function exportCsv() {
    const head = [
      t('film.list.scene'),
      t('film.frame.label'),
      t('film.frame.shot'),
      t('film.frame.angle'),
      t('film.frame.movement'),
      t('film.frame.lens'),
      t('film.frame.duration'),
      t('film.frame.action'),
      t('film.frame.dialogue'),
      t('film.frame.audio'),
      t('film.frame.location'),
      t('film.frame.cast'),
      t('film.frame.notes'),
      t('film.frame.status'),
      t('tags.title'),
    ];
    const rows = groups.flatMap((g) =>
      g.frames.map((f) => [
        g.scene ? `${g.scene.number} ${slugline(g.scene)} ${g.scene.title}`.trim() : '',
        labels.get(f.id) ?? '',
        presetText('film.shot', SHOT_SIZES, f.shot),
        presetText('film.angle', SHOT_ANGLES, f.angle),
        presetText('film.movement', SHOT_MOVEMENTS, f.movement),
        f.lens ?? '',
        secondsText(f.durationMs),
        f.action ?? '',
        f.dialogue ?? '',
        f.audio ?? '',
        f.location ?? '',
        (f.cast ?? []).join(', '),
        f.notes ?? '',
        t(`film.status.${f.status ?? 'draft'}`),
        (f.tags ?? []).join(', '),
      ]),
    );
    downloadCsv(`${boardTitle || 'shotlist'}.csv`, [head, ...rows]);
  }

  return (
    <div className="shots">
      <div className="story__bar" data-chrome>
        <div className="view-tabs" role="tablist" aria-label={t('film.views.label')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'table'}
            className="view-tabs__tab"
            onClick={() => setMode('table')}
          >
            <Icon name="shotlist" size={14} />
            {t('film.list.table')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'kanban'}
            className="view-tabs__tab"
            onClick={() => setMode('kanban')}
          >
            <Icon name="board" size={14} />
            {t('film.list.kanban')}
          </button>
        </div>
        <input
          className="ink-input shots__filter"
          type="search"
          value={query}
          placeholder={t('film.list.filter')}
          aria-label={t('film.list.filter')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="ink-input"
          value={status}
          aria-label={t('film.frame.status')}
          onChange={(e) => setStatus(e.target.value as FrameStatus | '')}
        >
          <option value="">{t('film.list.allStatuses')}</option>
          {FRAME_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`film.status.${s}`)}
            </option>
          ))}
        </select>
        <span className="story__total">
          {t('film.total', {
            count: frames.length,
            duration: formatDuration(totalDurationMs(frames)),
          })}
        </span>
        <span className="ink-header__spacer" />
        <Button icon="download" disabled={frames.length === 0} onClick={exportCsv}>
          {t('film.list.export')}
        </Button>
      </div>
      <div className="story__main">
        <div className="shots__scroll" data-scroll>
          {frames.length === 0 ? (
            <div className="board-state">
              <EmptyState icon="shotlist" title={t('film.list.empty')}>
                {t('film.empty.body')}
              </EmptyState>
            </div>
          ) : shown.length === 0 ? (
            <p className="ink-muted shots__none">{t('film.list.noMatch')}</p>
          ) : mode === 'kanban' ? (
            <ShotlistKanban
              store={store}
              frames={allFilteredFrames}
              labels={labels}
              boardAspect={boardAspect}
              selected={selected}
              onSelect={setSelected}
              readOnly={readOnly}
              onAddFrame={addFrameInStatus}
            />
          ) : (
            <table className="shots__table">
              <thead>
                <tr>
                  <th className="shots__pic-col">{t('film.list.picture')}</th>
                  <th>{t('film.frame.label')}</th>
                  <th>{t('film.frame.shot')}</th>
                  <th>{t('film.frame.angle')}</th>
                  <th>{t('film.frame.movement')}</th>
                  <th>{t('film.frame.lens')}</th>
                  <th>{t('film.frame.duration')}</th>
                  <th className="shots__wide">{t('film.frame.action')}</th>
                  <th className="shots__wide">{t('film.frame.dialogue')}</th>
                  <th>{t('film.frame.location')}</th>
                  <th>{t('film.frame.status')}</th>
                </tr>
              </thead>
              {shown.map((g) => (
                <tbody key={g.scene?.id ?? 'loose'}>
                  <tr className="shots__scene">
                    <th colSpan={11} scope="rowgroup">
                      {g.scene ? (
                        <>
                          <span className="shots__scene-number">{g.scene.number}</span>
                          <GuestVisibility store={store} element={g.scene} />
                          {slugline(g.scene)}
                          {g.scene.title && (
                            <span className="shots__scene-title">{g.scene.title}</span>
                          )}
                        </>
                      ) : (
                        t('film.loose')
                      )}
                      <span className="shots__scene-meta">
                        {t('film.total', {
                          count: g.frames.length,
                          duration: formatDuration(totalDurationMs(g.frames)),
                        })}
                      </span>
                    </th>
                  </tr>
                  {g.frames.map((f) => (
                    <tr
                      key={f.id}
                      className={selected === f.id ? 'is-selected' : undefined}
                      onClick={() => setSelected((s) => (s === f.id ? null : f.id))}
                    >
                      <td className="shots__pic-col">
                        <FramePicture
                          assetId={f.assetId}
                          aspect={f.aspect}
                          boardAspect={boardAspect}
                          strokes={f.strokes}
                          pixels={240}
                        />
                        <CardReview elementId={f.id} withPins={false} />
                      </td>
                      <td className="shots__label">
                        {labels.get(f.id)} <GuestVisibility store={store} element={f} />
                        <FrameVisibilityButton store={store} frame={f} readOnly={readOnly} />
                      </td>
                      <td>
                        <PresetField
                          compact
                          label={t('film.frame.shot')}
                          value={f.shot}
                          codes={SHOT_SIZES}
                          prefix="film.shot"
                          readOnly={readOnly}
                          onCommit={(shot) => set(f.id, { shot })}
                        />
                      </td>
                      <td>
                        <PresetField
                          compact
                          label={t('film.frame.angle')}
                          value={f.angle}
                          codes={SHOT_ANGLES}
                          prefix="film.angle"
                          readOnly={readOnly}
                          onCommit={(angle) => set(f.id, { angle })}
                        />
                      </td>
                      <td>
                        <PresetField
                          compact
                          label={t('film.frame.movement')}
                          value={f.movement}
                          codes={SHOT_MOVEMENTS}
                          prefix="film.movement"
                          readOnly={readOnly}
                          onCommit={(movement) => set(f.id, { movement })}
                        />
                      </td>
                      <td>
                        <Cell
                          label={t('film.frame.lens')}
                          value={f.lens ?? ''}
                          readOnly={readOnly}
                          onCommit={(v) => set(f.id, { lens: v.trim().slice(0, 60) || undefined })}
                        />
                      </td>
                      <td>
                        <Cell
                          label={t('film.frame.duration')}
                          value={secondsText(f.durationMs)}
                          readOnly={readOnly}
                          narrow
                          onCommit={(v) => set(f.id, { durationMs: parseSeconds(v) })}
                        />
                      </td>
                      <td className="shots__wide">
                        <Cell
                          label={t('film.frame.action')}
                          value={f.action ?? ''}
                          readOnly={readOnly}
                          multiline
                          onCommit={(v) => set(f.id, { action: v.trim() || undefined })}
                        />
                      </td>
                      <td className="shots__wide">
                        <Cell
                          label={t('film.frame.dialogue')}
                          value={f.dialogue ?? ''}
                          readOnly={readOnly}
                          multiline
                          onCommit={(v) => set(f.id, { dialogue: v.trim() || undefined })}
                        />
                      </td>
                      <td>
                        <Cell
                          label={t('film.frame.location')}
                          value={f.location ?? ''}
                          readOnly={readOnly}
                          onCommit={(v) =>
                            set(f.id, { location: v.trim().slice(0, 200) || undefined })
                          }
                        />
                      </td>
                      <td>
                        <StatusSelect
                          value={f.status}
                          readOnly={readOnly}
                          label={t('film.frame.status')}
                          onCommit={(s) => set(f.id, { status: s })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </div>
        {currentFrame && (
          <FramePanel
            store={store}
            frame={currentFrame}
            label={labels.get(currentFrame.id) ?? ''}
            boardAspect={boardAspect}
            projectId={projectId}
            boardId={boardId}
            readOnly={readOnly}
            onClose={() => setSelected(null)}
            onDraw={() => setDrawing(currentFrame.id)}
          />
        )}
      </div>
      {drawing && drawn && (
        <DrawingEditor
          store={store}
          frame={drawn}
          label={labels.get(drawn.id) ?? ''}
          boardAspect={boardAspect}
          prevLabel={drawnAt > 0 ? (labels.get(frames[drawnAt - 1].id) ?? null) : null}
          nextLabel={
            drawnAt < frames.length - 1 ? (labels.get(frames[drawnAt + 1].id) ?? null) : null
          }
          readOnly={readOnly}
          onClose={() => setDrawing(null)}
          onPrev={() => drawnAt > 0 && setDrawing(frames[drawnAt - 1].id)}
          onNext={() => drawnAt < frames.length - 1 && setDrawing(frames[drawnAt + 1].id)}
        />
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  onCommit,
  readOnly,
  multiline,
  narrow,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  readOnly: boolean;
  multiline?: boolean;
  narrow?: boolean;
}) {
  if (multiline) {
    return (
      <textarea
        key={value}
        className="shots__cell"
        defaultValue={value}
        aria-label={label}
        readOnly={readOnly}
        rows={2}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      />
    );
  }
  return (
    <input
      key={value}
      className={`shots__cell${narrow ? ' shots__cell--narrow' : ''}`}
      defaultValue={value}
      aria-label={label}
      readOnly={readOnly}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={blurOnEnter}
    />
  );
}

/**
 * Quotes every field (RFC 4180). Text that a spreadsheet would run as a formula gets a
 * leading apostrophe, so a shared board cannot put one in someone else's sheet.
 */
export function toCsv(rows: string[][]): string {
  const field = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(field).join(',')).join('\r\n');
}

function downloadCsv(name: string, rows: string[][]) {
  // The byte order mark makes spreadsheet apps read the file as UTF-8.
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
