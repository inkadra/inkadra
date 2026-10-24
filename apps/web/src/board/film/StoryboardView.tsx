import {
  addFrame,
  addScene,
  deleteElements,
  type FrameElement,
  formatDuration,
  frameLabels,
  moveFrames,
  type SceneElement,
  type SceneGroup,
  storyboardOf,
  totalDurationMs,
  updateElement,
} from '@inkadra/canvas-core';
import { ASPECT_RATIOS, type AspectRatio, SHOT_SIZES, setBoardAspect } from '@inkadra/doc-schema';
import { Button, EmptyState, Icon, IconButton } from '@inkadra/ui';
import { type DragEvent, memo, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CardReview } from '../CardReview.tsx';
import { GuestVisibility, GuestVisibilityIcon, toggleGuestHidden } from '../guest-visibility.tsx';
import { type BoardStore, LOCAL } from '../store.ts';
import { aspectLabel, useBoardAspect } from './aspect.ts';
import { DrawingEditor } from './DrawingEditor.tsx';
import { FramePanel } from './FramePanel.tsx';
import { FramePicture } from './FramePicture.tsx';
import { blurOnEnter, StatusChip, usePresetText } from './fields.tsx';

const FRAME_MIME = 'application/x-inkadra-frame';

/** Scenes and frames of the board, in order, from the live document. */
export function useStoryboard(store: BoardStore) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    const groups = storyboardOf([...snap.byId.values()]);
    const frames = groups.flatMap((g) => g.frames);
    return { groups, frames, labels: frameLabels(groups) };
  }, [snap]);
}

export function StoryboardView({
  store,
  projectId,
  boardId,
  userId,
  readOnly,
}: {
  store: BoardStore;
  projectId: string;
  boardId: string;
  userId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const { groups, frames, labels } = useStoryboard(store);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ scene: string; index: number } | null>(null);
  const opts = { userId, origin: LOCAL };
  const current = frames.find((f) => f.id === selected) ?? null;
  const drawn = frames.find((f) => f.id === drawing) ?? null;
  const drawnAt = drawn ? frames.indexOf(drawn) : -1;

  const newScene = () => {
    store.undo.stopCapturing();
    addScene(store.doc, {}, opts);
  };
  const newFrame = (sceneId: string | null) => {
    store.undo.stopCapturing();
    const f = addFrame(store.doc, sceneId, null, {}, opts);
    setSelected(f.id);
  };

  function onDrop(e: DragEvent, sceneId: string, index: number) {
    const id = e.dataTransfer.getData(FRAME_MIME);
    setDrop(null);
    if (!id || readOnly) return;
    e.preventDefault();
    store.undo.stopCapturing();
    moveFrames(store.doc, [id], sceneId, index, LOCAL);
  }

  const total = totalDurationMs(frames);
  return (
    <div className="story">
      <div className="story__bar" data-chrome>
        <label className="story__aspect">
          <span>{t('film.aspect.label')}</span>
          <select
            className="ink-input"
            value={boardAspect}
            disabled={readOnly}
            onChange={(e) => setBoardAspect(store.doc, e.target.value as AspectRatio, LOCAL)}
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {aspectLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <span className="story__total">
          {t('film.total', { count: frames.length, duration: formatDuration(total) })}
        </span>
        <span className="ink-header__spacer" />
        {!readOnly && (
          <Button icon="plus" onClick={newScene}>
            {t('film.scene.add')}
          </Button>
        )}
      </div>
      <div className="story__main">
        <div className="story__scroll" data-scroll>
          {groups.length === 0 && (
            <div className="board-state">
              <EmptyState
                icon="storyboard"
                title={t('film.empty.title')}
                actions={
                  !readOnly && (
                    <Button variant="primary" icon="plus" onClick={newScene}>
                      {t('film.scene.add')}
                    </Button>
                  )
                }
              >
                {t('film.empty.body')}
              </EmptyState>
            </div>
          )}
          {groups.map((g) => (
            <SceneSection
              key={g.scene?.id ?? 'loose'}
              group={g}
              store={store}
              readOnly={readOnly}
              onAddFrame={() => newFrame(g.scene?.id ?? null)}
            >
              {g.frames.map((f, i) => (
                <FrameTile
                  key={f.id}
                  frame={f}
                  store={store}
                  label={labels.get(f.id) ?? ''}
                  boardAspect={boardAspect}
                  selected={f.id === selected}
                  readOnly={readOnly}
                  dropBefore={!!g.scene && drop?.scene === g.scene.id && drop.index === i}
                  onSelect={() => setSelected(f.id)}
                  onDraw={() => setDrawing(f.id)}
                  onDragOver={(e, after) => {
                    if (!g.scene || readOnly) return;
                    e.preventDefault();
                    const index = after ? i + 1 : i;
                    if (drop?.scene !== g.scene.id || drop.index !== index)
                      setDrop({ scene: g.scene.id, index });
                  }}
                  onDrop={(e) => g.scene && drop && onDrop(e, g.scene.id, drop.index)}
                />
              ))}
              {!readOnly && (
                <li className="story__add-item">
                  <button
                    type="button"
                    className={`story__add${g.scene && drop?.scene === g.scene.id && drop.index === g.frames.length ? ' is-drop' : ''}`}
                    onClick={() => newFrame(g.scene?.id ?? null)}
                    onDragOver={(e) => {
                      if (!g.scene) return;
                      e.preventDefault();
                      setDrop({ scene: g.scene.id, index: g.frames.length });
                    }}
                    onDragLeave={() => setDrop(null)}
                    onDrop={(e) => g.scene && onDrop(e, g.scene.id, g.frames.length)}
                  >
                    <Icon name="plus" size={16} />
                    {t('film.frame.add')}
                  </button>
                </li>
              )}
            </SceneSection>
          ))}
        </div>
        {current && (
          <FramePanel
            store={store}
            frame={current}
            label={labels.get(current.id) ?? ''}
            boardAspect={boardAspect}
            projectId={projectId}
            boardId={boardId}
            readOnly={readOnly}
            onClose={() => setSelected(null)}
            onDraw={() => setDrawing(current.id)}
          />
        )}
      </div>
      {drawn && (
        <DrawingEditor
          store={store}
          frame={drawn}
          label={labels.get(drawn.id) ?? ''}
          boardAspect={boardAspect}
          readOnly={readOnly}
          onClose={() => setDrawing(null)}
          onPrev={drawnAt > 0 ? () => setDrawing(frames[drawnAt - 1]?.id ?? null) : undefined}
          onNext={
            drawnAt < frames.length - 1
              ? () => setDrawing(frames[drawnAt + 1]?.id ?? null)
              : undefined
          }
        />
      )}
    </div>
  );
}

/** INT. KITCHEN – NIGHT, from the scene fields. */
export function useSlugline() {
  const { t } = useTranslation();
  return (scene: SceneElement) =>
    [
      scene.setting && t(`film.scene.settings.${scene.setting}`),
      scene.location?.toUpperCase(),
      scene.time && `– ${t(`film.scene.times.${scene.time}`)}`,
    ]
      .filter(Boolean)
      .join(' ');
}

function SceneSection({
  group,
  store,
  readOnly,
  onAddFrame,
  children,
}: {
  group: SceneGroup;
  store: BoardStore;
  readOnly: boolean;
  onAddFrame: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { scene, frames } = group;
  const duration = formatDuration(totalDurationMs(frames));
  if (!scene) {
    return (
      <section className="story__scene">
        <header className="story__scene-head">
          <span className="story__scene-title">{t('film.loose')}</span>
          <span className="story__scene-meta">
            {t('film.total', { count: frames.length, duration })}
          </span>
        </header>
        <ul className="story__grid">{children}</ul>
      </section>
    );
  }
  const set = (patch: Partial<Omit<SceneElement, 'id' | 'type'>>) =>
    updateElement(store.doc, scene.id, patch, LOCAL);
  return (
    <section
      className="story__scene"
      aria-label={t('film.scene.heading', { number: scene.number })}
    >
      <header className="story__scene-head">
        <button
          type="button"
          className="column__toggle"
          aria-expanded={!scene.collapsed}
          aria-label={scene.collapsed ? t('film.scene.expand') : t('film.scene.collapse')}
          onClick={() => set({ collapsed: scene.collapsed ? undefined : true })}
        >
          <Icon name="chevronDown" size={14} />
        </button>
        <input
          key={`n${scene.number}`}
          className="card__inline-input story__scene-number"
          defaultValue={scene.number}
          readOnly={readOnly}
          aria-label={t('film.scene.number')}
          onBlur={(e) => {
            const v = e.target.value.trim().slice(0, 12);
            if (v !== scene.number) set({ number: v });
          }}
          onKeyDown={blurOnEnter}
        />
        <select
          className="ink-input story__scene-select"
          value={scene.setting ?? ''}
          disabled={readOnly}
          aria-label={t('film.scene.setting')}
          onChange={(e) =>
            set({ setting: (e.target.value || undefined) as SceneElement['setting'] })
          }
        >
          <option value="">—</option>
          {(['int', 'ext', 'int-ext'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`film.scene.settings.${s}`)}
            </option>
          ))}
        </select>
        <input
          key={`l${scene.location ?? ''}`}
          className="card__inline-input story__scene-location"
          defaultValue={scene.location ?? ''}
          placeholder={t('film.scene.location')}
          readOnly={readOnly}
          aria-label={t('film.scene.location')}
          onBlur={(e) => {
            const v = e.target.value.trim().slice(0, 200) || undefined;
            if (v !== scene.location) set({ location: v });
          }}
          onKeyDown={blurOnEnter}
        />
        <select
          className="ink-input story__scene-select"
          value={scene.time ?? ''}
          disabled={readOnly}
          aria-label={t('film.scene.time')}
          onChange={(e) => set({ time: (e.target.value || undefined) as SceneElement['time'] })}
        >
          <option value="">—</option>
          {(['day', 'night', 'dawn', 'dusk'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`film.scene.times.${s}`)}
            </option>
          ))}
        </select>
        <input
          key={`t${scene.title}`}
          className="card__inline-input story__scene-title"
          defaultValue={scene.title}
          placeholder={t('film.scene.untitled')}
          readOnly={readOnly}
          aria-label={t('film.scene.title')}
          onBlur={(e) => {
            const v = e.target.value.trim().slice(0, 200);
            if (v !== scene.title) set({ title: v });
          }}
          onKeyDown={blurOnEnter}
        />
        <span className="story__scene-meta">
          {t('film.total', { count: frames.length, duration })}
        </span>
        <GuestVisibility store={store} element={scene} />
        {!readOnly && (
          <>
            <button
              type="button"
              className="ink-iconbtn"
              aria-label={t('guestVisibility.hide')}
              title={t('guestVisibility.hide')}
              aria-pressed={!!scene.guestHidden}
              onClick={() => toggleGuestHidden(store, [scene.id])}
            >
              <GuestVisibilityIcon />
            </button>
            <IconButton icon="plus" label={t('film.frame.add')} onClick={onAddFrame} />
            <IconButton
              icon="trash"
              label={t('film.scene.delete')}
              onClick={() => {
                store.undo.stopCapturing();
                deleteElements(store.doc, [scene.id], LOCAL);
              }}
            />
          </>
        )}
      </header>
      {!scene.collapsed && (
        <>
          {(scene.synopsis || !readOnly) && (
            <textarea
              key={`s${scene.synopsis ?? ''}`}
              className="card__inline-input story__synopsis"
              defaultValue={scene.synopsis ?? ''}
              placeholder={t('film.scene.synopsis')}
              aria-label={t('film.scene.synopsis')}
              readOnly={readOnly}
              rows={1}
              onBlur={(e) => {
                const v = e.target.value.trim().slice(0, 2000) || undefined;
                if (v !== scene.synopsis) set({ synopsis: v });
              }}
            />
          )}
          <ul className="story__grid">{children}</ul>
        </>
      )}
    </section>
  );
}

const FrameTile = memo(function FrameTile({
  frame,
  store,
  label,
  boardAspect,
  selected,
  readOnly,
  dropBefore,
  onSelect,
  onDraw,
  onDragOver,
  onDrop,
}: {
  frame: FrameElement;
  store: BoardStore;
  label: string;
  boardAspect: AspectRatio;
  selected: boolean;
  readOnly: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onDraw: () => void;
  onDragOver: (e: DragEvent, after: boolean) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const presetText = usePresetText();
  const shot = presetText('film.shot', SHOT_SIZES, frame.shot);
  return (
    <li
      className={`story__tile${selected ? ' is-selected' : ''}${dropBefore ? ' is-drop' : ''}`}
      draggable={!readOnly}
      onDragStart={(e) => {
        e.dataTransfer.setData(FRAME_MIME, frame.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e, e.clientX > r.left + r.width / 2);
      }}
      onDrop={onDrop}
    >
      <GuestVisibility store={store} element={frame} />
      <button
        type="button"
        className="story__tile-pic"
        onClick={onSelect}
        onDoubleClick={onDraw}
        aria-label={label}
        aria-pressed={selected}
      >
        <FramePicture
          assetId={frame.assetId}
          aspect={frame.aspect}
          boardAspect={boardAspect}
          strokes={frame.strokes}
          pixels={480}
        />
      </button>
      <div className="story__tile-meta">
        <span className="story__tile-label">{label}</span>
        {shot && <span className="story__tile-shot">{shot}</span>}
        <span className="ink-header__spacer" />
        {frame.durationMs !== undefined && (
          <span className="story__tile-duration">{formatDuration(frame.durationMs)}</span>
        )}
        <StatusChip status={frame.status} />
      </div>
      <CardReview elementId={frame.id} withPins={false} />
      {frame.action && <p className="story__tile-action">{frame.action}</p>}
    </li>
  );
});
