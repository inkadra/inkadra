import { deleteElements, type FrameElement, updateElement } from '@inkadra/canvas-core';
import {
  ASPECT_RATIOS,
  type AspectRatio,
  SHOT_ANGLES,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
} from '@inkadra/doc-schema';
import { Button, IconButton } from '@inkadra/ui';
import { useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterActions } from '../../commands/actions.ts';
import {
  duplicateInStore,
  framePanelActions,
  setFrameStatus,
} from '../../commands/board-actions.ts';
import { GuestModeContext } from '../context.ts';
import { authorName, editableText } from '../review-model.ts';
import { openComments, useReviews } from '../review-store.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { TagEditor } from '../tags.tsx';
import { startUpload } from '../uploads.ts';
import { aspectLabel } from './aspect.ts';
import { FramePicture } from './FramePicture.tsx';
import { PresetField, parseSeconds, StatusSelect, secondsText, TextField } from './fields.tsx';

type Patch = Partial<Omit<FrameElement, 'id' | 'type'>>;

/** Side panel with every field of a frame. */
export function FramePanel({
  store,
  frame,
  label,
  boardAspect,
  projectId,
  boardId,
  readOnly,
  userId = null,
  id,
  takeFocus = false,
  onClose,
  onDraw,
}: {
  store: BoardStore;
  frame: FrameElement;
  label: string;
  boardAspect: AspectRatio;
  projectId: string;
  boardId: string;
  readOnly: boolean;
  userId?: string | null;
  id?: string;
  /** Move focus into the panel when it opens, for a panel that covers what opened it. */
  takeFocus?: boolean;
  onClose: () => void;
  onDraw: () => void;
}) {
  const { t } = useTranslation();
  const duplicate = () => {
    duplicateInStore(store, [frame.id], userId);
  };
  const guest = useContext(GuestModeContext);
  useRegisterActions(
    framePanelActions({ readOnly: readOnly || guest, store, frameId: frame.id, duplicate, t }),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Patch) => !readOnly && updateElement(store.doc, frame.id, patch, LOCAL);
  const text = (v: string) => v.trim() || undefined;
  const panel = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when another frame opens
  useEffect(() => {
    if (takeFocus) panel.current?.focus();
  }, [takeFocus, frame.id]);
  return (
    <aside
      ref={panel}
      id={id}
      className="film-panel"
      aria-label={t('film.frame.details')}
      tabIndex={takeFocus ? -1 : undefined}
      data-chrome
      data-scroll
    >
      <header className="film-panel__head">
        <span className="film-panel__label">{label}</span>
        <StatusSelect
          value={frame.status}
          readOnly={readOnly}
          label={t('film.frame.status')}
          onCommit={(status) => {
            if (!readOnly) setFrameStatus(store, frame.id, status);
          }}
        />
        <span className="ink-header__spacer" />
        <IconButton icon="close" label={t('film.frame.close')} onClick={onClose} />
      </header>
      <div className="film-panel__body">
        <div className="film-panel__picture">
          <FramePicture
            assetId={frame.assetId}
            aspect={frame.aspect}
            boardAspect={boardAspect}
            strokes={frame.strokes}
            shapes={frame.shapes}
            referenceOpacity={frame.referenceOpacity}
            pixels={640}
          />
          {!readOnly && (
            <div className="film-panel__picture-actions">
              <Button icon="pen" onClick={onDraw}>
                {t('film.frame.draw')}
              </Button>
              <Button icon="upload" variant="ghost" onClick={() => fileInput.current?.click()}>
                {t('film.frame.upload')}
              </Button>
              {frame.assetId && (
                <Button variant="ghost" onClick={() => set({ assetId: undefined })}>
                  {t('film.frame.removePicture')}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="film-panel__row">
          <TextField
            label={t('film.frame.label')}
            value={frame.label ?? ''}
            placeholder={t('film.frame.labelAuto', { label })}
            readOnly={readOnly}
            onCommit={(v) => set({ label: text(v)?.slice(0, 12) })}
          />
          <div className="film-field">
            <label htmlFor={`aspect-${frame.id}`}>{t('film.aspect.label')}</label>
            <select
              id={`aspect-${frame.id}`}
              className="ink-input"
              value={frame.aspect ?? ''}
              disabled={readOnly}
              onChange={(e) => set({ aspect: (e.target.value || undefined) as AspectRatio })}
            >
              <option value="">
                {t('film.aspect.board', { ratio: aspectLabel(boardAspect) })}
              </option>
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {aspectLabel(r)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TextField
          label={t('film.frame.action')}
          value={frame.action ?? ''}
          placeholder={t('film.frame.actionPlaceholder')}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ action: text(v) })}
        />
        <div className="film-panel__row">
          <PresetField
            label={t('film.frame.shot')}
            value={frame.shot}
            codes={SHOT_SIZES}
            prefix="film.shot"
            readOnly={readOnly}
            onCommit={(shot) => set({ shot })}
          />
          <PresetField
            label={t('film.frame.angle')}
            value={frame.angle}
            codes={SHOT_ANGLES}
            prefix="film.angle"
            readOnly={readOnly}
            onCommit={(angle) => set({ angle })}
          />
        </div>
        <div className="film-panel__row">
          <PresetField
            label={t('film.frame.movement')}
            value={frame.movement}
            codes={SHOT_MOVEMENTS}
            prefix="film.movement"
            readOnly={readOnly}
            onCommit={(movement) => set({ movement })}
          />
          <TextField
            label={t('film.frame.lens')}
            value={frame.lens ?? ''}
            placeholder="35mm"
            readOnly={readOnly}
            onCommit={(v) => set({ lens: text(v)?.slice(0, 60) })}
          />
        </div>
        <div className="film-panel__row">
          <TextField
            label={t('film.frame.duration')}
            value={secondsText(frame.durationMs)}
            type="number"
            readOnly={readOnly}
            onCommit={(v) => set({ durationMs: parseSeconds(v) })}
          />
          <TextField
            label={t('film.frame.location')}
            value={frame.location ?? ''}
            readOnly={readOnly}
            onCommit={(v) => set({ location: text(v)?.slice(0, 200) })}
          />
        </div>
        <TextField
          label={t('film.frame.cast')}
          value={(frame.cast ?? []).join(', ')}
          hint={t('film.frame.castHint')}
          readOnly={readOnly}
          onCommit={(v) => {
            const cast = [
              ...new Set(
                v
                  .split(',')
                  .map((c) => c.trim().slice(0, 80))
                  .filter(Boolean),
              ),
            ].slice(0, 30);
            set({ cast: cast.length > 0 ? cast : undefined });
          }}
        />
        <TextField
          label={t('film.frame.dialogue')}
          value={frame.dialogue ?? ''}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ dialogue: text(v) })}
        />
        <TextField
          label={t('film.frame.audio')}
          value={frame.audio ?? ''}
          readOnly={readOnly}
          onCommit={(v) => set({ audio: text(v)?.slice(0, 500) })}
        />
        <TextField
          label={t('film.frame.notes')}
          value={frame.notes ?? ''}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ notes: text(v) })}
        />
        <div className="film-field">
          <span className="film-field__label">{t('tags.title')}</span>
          <TagEditor
            tags={frame.tags ?? []}
            readOnly={readOnly}
            projectId={projectId}
            onChange={(tags) => set({ tags })}
          />
        </div>
        <FrameComments elementId={frame.id} />
        {!readOnly && (
          <div className="film-panel__actions">
            <Button icon="copy" onClick={duplicate}>
              {t('film.frame.duplicate')}
            </Button>
            {frame.status !== 'ready' && (
              <Button
                icon="check"
                variant="primary"
                onClick={() => setFrameStatus(store, frame.id, 'ready')}
              >
                {t('film.frame.markReady')}
              </Button>
            )}
          </div>
        )}
        {!readOnly && (
          <Button
            icon="trash"
            variant="danger"
            className="film-panel__delete"
            onClick={() => {
              store.undo.stopCapturing();
              deleteElements(store.doc, [frame.id], LOCAL);
              onClose();
            }}
          >
            {t('film.frame.delete')}
          </Button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const id = frame.id;
          startUpload({
            file,
            projectId,
            boardId,
            onAsset: (assetId) => updateElement(store.doc, id, { assetId }, LOCAL),
          });
        }}
      />
    </aside>
  );
}

const PREVIEW_THREADS = 3;

/**
 * The open comment threads of the frame, newest first, from the board's comments; the full
 * thread opens in the comments panel. Nothing on the guest page nor while a version is shown.
 */
function FrameComments({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const available = useReviews((s) => !!s.boardId && !s.preview);
  const open = useReviews((s) => s.counts.get(elementId)?.open ?? 0);
  const all = useReviews((s) => s.threads);
  if (guest || !available) return null;
  const threads = all
    .filter((th) => th.elementId === elementId && !th.resolvedAt && !th.deletedAt)
    .slice(0, PREVIEW_THREADS);
  return (
    <section className="film-comments" aria-labelledby={`comments-${elementId}`}>
      <div className="film-comments__head">
        <h3 id={`comments-${elementId}`}>{t('film.frame.comments')}</h3>
        {open > 0 && <span>{t('film.frame.commentsCount', { count: open })}</span>}
      </div>
      {threads.length === 0 ? (
        <p className="film-comments__empty">{t('film.frame.commentsNone')}</p>
      ) : (
        <ul>
          {threads.map((th) => (
            <li key={th.id}>
              <button
                type="button"
                className="film-comments__thread"
                onClick={() => openComments({ elementId, threadId: th.id })}
              >
                <strong>{authorName(th.author) ?? t('comments.deletedAuthor')}</strong>
                <span>{editableText(th)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" icon="comment" onClick={() => openComments({ elementId })}>
        {t('film.frame.commentsOpen')}
      </Button>
    </section>
  );
}
