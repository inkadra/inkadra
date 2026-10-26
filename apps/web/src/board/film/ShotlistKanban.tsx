// SPDX-License-Identifier: AGPL-3.0-only
import { type FrameElement, formatDuration, updateElement } from '@inkadra/canvas-core';
import { type AspectRatio, SHOT_SIZES } from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import { type DragEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardReview } from '../CardReview.tsx';
import { type BoardStore, LOCAL } from '../store.ts';
import { FramePicture } from './FramePicture.tsx';
import { usePresetText } from './fields.tsx';
import { getFrameKanbanColumn, type KanbanColumnKey } from './film-status.ts';

const FRAME_MIME = 'application/x-inkadra-frame';

export const KANBAN_COLUMNS: Array<{
  key: KanbanColumnKey;
  labelKey: string;
  dotColor: string;
}> = [
  {
    key: 'todo',
    labelKey: 'film.status.todo',
    dotColor: 'var(--ink-text-muted, #8A8A90)',
  },
  {
    key: 'ready',
    labelKey: 'film.status.ready',
    dotColor: 'var(--ink-tag-blue, #60A5FA)',
  },
  {
    key: 'shot',
    labelKey: 'film.status.shot',
    dotColor: 'var(--ink-status-ok, #34D399)',
  },
  {
    key: 'retake',
    labelKey: 'film.status.retake',
    dotColor: 'var(--ink-status-warn, #F87171)',
  },
  {
    key: 'approved',
    labelKey: 'film.status.approved',
    dotColor: 'var(--ink-tag-purple, #A78BFA)',
  },
];

export function ShotlistKanban({
  store,
  frames,
  labels,
  boardAspect,
  selected,
  onSelect,
  readOnly,
  onAddFrame,
}: {
  store: BoardStore;
  frames: FrameElement[];
  labels: Map<string, string>;
  boardAspect: AspectRatio;
  selected: string | null;
  onSelect: (id: string | null) => void;
  readOnly: boolean;
  onAddFrame: (status: KanbanColumnKey) => void;
}) {
  const { t } = useTranslation();
  const presetText = usePresetText();
  const [dropTarget, setDropTarget] = useState<KanbanColumnKey | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());

  const onDragStart = (e: DragEvent, id: string) => {
    if (readOnly) return;
    e.dataTransfer.setData(FRAME_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent, colKey: KanbanColumnKey) => {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== colKey) setDropTarget(colKey);
  };

  const moveCard = (id: string, targetCol: KanbanColumnKey) => {
    if (readOnly) return;
    store.undo.stopCapturing();
    if (targetCol === 'approved') {
      updateElement(store.doc, id, { approved: true }, LOCAL);
    } else {
      updateElement(
        store.doc,
        id,
        { status: targetCol === 'todo' ? 'todo' : targetCol, approved: false },
        LOCAL,
      );
    }
  };

  const onDrop = (e: DragEvent, targetCol: KanbanColumnKey) => {
    if (readOnly) return;
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData(FRAME_MIME);
    if (!id) return;
    moveCard(id, targetCol);
  };

  const toggleColExpanded = (colKey: string) => {
    setExpandedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  };

  return (
    <div className="kanban">
      {KANBAN_COLUMNS.map((col) => {
        const colFrames = frames.filter((f) => getFrameKanbanColumn(f) === col.key);

        const isExpanded = expandedCols.has(col.key);
        const cardLimit = 10;
        const visibleFrames =
          colFrames.length > cardLimit && !isExpanded ? colFrames.slice(0, cardLimit) : colFrames;

        return (
          <section
            key={col.key}
            className={`kanban__col${dropTarget === col.key ? ' is-drop-target' : ''}`}
            aria-label={t(col.labelKey)}
            onDragOver={(e) => onDragOver(e, col.key)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => onDrop(e, col.key)}
          >
            <div className="kanban__ch">
              <span className="kanban__dot" style={{ background: col.dotColor }} />
              <span>{t(col.labelKey)}</span>
              <span className="kanban__cnt">{colFrames.length}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="kanban__add"
                  aria-label={t('film.list.addInStatus', { status: t(col.labelKey) })}
                  title={t('film.list.addInStatus', { status: t(col.labelKey) })}
                  onClick={() => onAddFrame(col.key)}
                >
                  +
                </button>
              )}
            </div>
            <div className="kanban__cards">
              {col.key === 'approved' && colFrames.length === 0 ? (
                <div className="kanban__empty-col">
                  <Icon name="check" size={20} />
                  <span>{t('film.list.approvedHelper')}</span>
                </div>
              ) : null}
              {visibleFrames.map((f) => {
                const label = labels.get(f.id) ?? '';
                const lensOrShot = f.lens || presetText('film.shot', SHOT_SIZES, f.shot);
                const isSelected = selected === f.id;
                return (
                  <article
                    key={f.id}
                    className={`kanban__card${isSelected ? ' is-selected' : ''}`}
                    draggable={!readOnly}
                    onDragStart={(e) => onDragStart(e, f.id)}
                    onKeyDown={(e) => {
                      if (readOnly) return;
                      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                        e.preventDefault();
                        const currentIndex = KANBAN_COLUMNS.findIndex((c) => c.key === col.key);
                        const delta = e.key === 'ArrowRight' ? 1 : -1;
                        const nextCol = KANBAN_COLUMNS[currentIndex + delta];
                        if (nextCol) moveCard(f.id, nextCol.key);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="kanban__card-body"
                      onClick={() => onSelect(isSelected ? null : f.id)}
                      aria-label={t('film.list.cardAria', { label })}
                      aria-pressed={isSelected}
                    >
                      <div className="kanban__card-head">
                        <div className="kanban__card-pic">
                          <FramePicture
                            assetId={f.assetId}
                            aspect={f.aspect}
                            boardAspect={boardAspect}
                            strokes={f.strokes}
                            pixels={120}
                          />
                        </div>
                        <b className="kanban__card-label">{label}</b>
                        {f.durationMs ? (
                          <span className="kanban__card-duration">
                            {formatDuration(f.durationMs)}
                          </span>
                        ) : null}
                      </div>

                      {(f.action || f.dialogue) && (
                        <div className="kanban__card-action">{f.action || f.dialogue}</div>
                      )}

                      {(lensOrShot || f.location) && (
                        <div className="kanban__card-meta">
                          {lensOrShot && <span>{lensOrShot}</span>}
                          {f.location && <span className="kanban__card-pill">{f.location}</span>}
                        </div>
                      )}
                    </button>

                    <div className="kanban__card-foot">
                      {f.cast && f.cast.length > 0 ? (
                        <div className="kanban__cast">
                          {f.cast.slice(0, 3).map((name) => (
                            <span key={name} className="kanban__av" title={name}>
                              {name
                                .split(' ')
                                .map((w) => w[0])
                                .join('')
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span />
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {!readOnly && (
                          <select
                            className="kanban__move-select"
                            aria-label={t('film.list.moveToColumn')}
                            value=""
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const val = e.target.value as KanbanColumnKey;
                              if (val) moveCard(f.id, val);
                            }}
                          >
                            <option value="" disabled>
                              {t('film.list.moveToColumn')}
                            </option>
                            {KANBAN_COLUMNS.map((c) => (
                              <option key={c.key} value={c.key} disabled={c.key === col.key}>
                                {t('film.list.moveCard', { column: t(c.labelKey) })}
                              </option>
                            ))}
                          </select>
                        )}
                        <CardReview elementId={f.id} withPins={false} />
                      </div>
                    </div>
                  </article>
                );
              })}
              {colFrames.length > cardLimit && (
                <button
                  type="button"
                  className="kanban__collapse-toggle"
                  onClick={() => toggleColExpanded(col.key)}
                >
                  {isExpanded
                    ? t('film.list.collapseGroup')
                    : `+ ${colFrames.length - cardLimit} ${t('film.list.moreCards')}`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
