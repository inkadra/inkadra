import { deleteElements, type FrameElement, updateElement } from '@inkadra/canvas-core';
import {
  ASPECT_RATIOS,
  type AspectRatio,
  SHOT_ANGLES,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
} from '@inkadra/doc-schema';
import { Button, IconButton } from '@inkadra/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  onClose: () => void;
  onDraw: () => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Patch) => !readOnly && updateElement(store.doc, frame.id, patch, LOCAL);
  const text = (v: string) => v.trim() || undefined;
  return (
    <aside className="film-panel" aria-label={t('film.frame.details')} data-chrome data-scroll>
      <header className="film-panel__head">
        <span className="film-panel__label">{label}</span>
        <StatusSelect
          value={frame.status}
          readOnly={readOnly}
          label={t('film.frame.status')}
          onCommit={(status) => set({ status })}
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
