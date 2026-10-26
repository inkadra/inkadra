// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardStore } from '../store.ts';
import { CallSheetModal } from './CallSheetModal.tsx';
import { useStoryboard } from './StoryboardView.tsx';
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
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const dropped = frames.find((frame) => frame.id === droppedId);
  return (
    <section className="film-shell" aria-label={t('nav.schedule')}>
      <header>
        <h1>{t('nav.schedule')}</h1>
        <span className="film-shell__badge">{t('shells.demo')}</span>
        <Button onClick={() => setCallSheetOpen(true)}>{t('shells.callSheet')}</Button>
      </header>
      <p>{t('shells.scheduleUnavailable')}</p>
      <div className="film-shell__columns">
        <section>
          <h2>{t('nav.shotlist')}</h2>
          {frames.length === 0 && <p>{t('shells.noShots')}</p>}
          {frames.map((frame) => (
            <button
              type="button"
              onClick={() => {
                if (!readOnly) setDroppedId(frame.id);
              }}
              disabled={readOnly}
              key={frame.id}
              className="film-shell__card"
              draggable={!readOnly}
              onDragStart={(event) => {
                if (readOnly) {
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
        </section>
        <section>
          <h2>{t('shells.draftSlot')}</h2>
          <section
            className="film-shell__drop"
            aria-label={t('shells.draftSlot')}
            onDragOver={(event) => {
              if (!readOnly) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = resolveDroppedShot(
                event.dataTransfer.getData(SHOT_DRAG_TYPE),
                boardId,
                frames.map((frame) => frame.id),
                readOnly,
              );
              if (id) setDroppedId(id);
            }}
          >
            {dropped ? (
              <p>
                {labels.get(dropped.id)} · {dropped.action}
              </p>
            ) : (
              <p>{t('shells.dropShot')}</p>
            )}
          </section>
        </section>
      </div>
      {callSheetOpen && (
        <CallSheetModal projectName={projectName} onClose={() => setCallSheetOpen(false)} />
      )}
    </section>
  );
}
