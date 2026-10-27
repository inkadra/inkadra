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
  updateElement,
} from '@inkadra/canvas-core';
import { ASPECT_RATIOS, type AspectRatio, SHOT_SIZES, setBoardAspect } from '@inkadra/doc-schema';
import { Button, EmptyState, Icon, IconButton } from '@inkadra/ui';
import { type DragEvent, memo, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterActions } from '../../commands/actions.ts';
import { CardReview } from '../CardReview.tsx';
import { GuestVisibility, GuestVisibilityIcon, toggleGuestHidden } from '../guest-visibility.tsx';
import { type BoardStore, LOCAL } from '../store.ts';
import { Animatic } from './Animatic.tsx';
import { estimatedDurationMs } from './animatic.ts';
import { aspectLabel, useBoardAspect } from './aspect.ts';
import { DrawingEditor } from './DrawingEditor.tsx';
import { FramePanel } from './FramePanel.tsx';
import { FramePicture } from './FramePicture.tsx';
import { FrameVisibilityButton } from './FrameVisibilityButton.tsx';
import { blurOnEnter, StatusChip, usePresetText } from './fields.tsx';

const FRAME_MIME = 'application/x-inkadra-frame';
const STORY_MODES = ['grid', 'sequence', 'animatic'] as const;
const TILE_SIZES = ['s', 'm', 'l'] as const;
type StoryMode = (typeof STORY_MODES)[number];
type TileSize = (typeof TILE_SIZES)[number];
const LOOSE = 'loose';

const groupKey = (g: SceneGroup) => g.scene?.id ?? LOOSE;
/** A frame counts as drawn once it has a picture or a pen drawing. */
const isDrawn = (f: FrameElement) =>
  !!f.assetId || (f.strokes?.length ?? 0) > 0 || (f.shapes?.length ?? 0) > 0;

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
  const [mode, setMode] = useState<StoryMode>('grid');
  const [size, setSize] = useState<TileSize>('m');
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ scene: string; index: number } | null>(null);
  const opts = { userId, origin: LOCAL };
  // A scene deleted while it is the filter shows every scene again.
  const filter = groups.some((g) => groupKey(g) === sceneFilter) ? sceneFilter : null;
  const visible = filter ? groups.filter((g) => groupKey(g) === filter) : groups;
  const visibleFrames = visible.flatMap((g) => g.frames);
  const current = frames.find((f) => f.id === selected) ?? null;
  const drawn = frames.find((f) => f.id === drawing) ?? null;

  const newScene = () => {
    store.undo.stopCapturing();
    addScene(store.doc, {}, opts);
  };
  const newFrame = (sceneId: string | null) => {
    store.undo.stopCapturing();
    const f = addFrame(store.doc, sceneId, null, {}, opts);
    setSelected(f.id);
  };

  useRegisterActions(
    readOnly
      ? []
      : [
          { id: 'add-scene', label: t('film.scene.add'), run: newScene },
          {
            id: 'add-frame',
            label: t('film.frame.add'),
            run: () => newFrame(current?.parent ?? (filter === LOOSE ? null : filter)),
          },
        ],
  );

  function onDrop(e: DragEvent, sceneId: string, index: number) {
    const id = e.dataTransfer.getData(FRAME_MIME);
    setDrop(null);
    if (!id || readOnly) return;
    e.preventDefault();
    store.undo.stopCapturing();
    moveFrames(store.doc, [id], sceneId, index, LOCAL);
  }

  const total = estimatedDurationMs(frames);
  return (
    <div className={`story story--${mode} story--${size}`}>
      <div className="story__bar" data-chrome>
        <fieldset className="story__modes" aria-label={t('film.playback.mode')}>
          {STORY_MODES.map((value) => (
            <button
              type="button"
              key={value}
              className="story__mode"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                if (value === 'animatic') setSelected(null);
              }}
            >
              {t(`film.playback.${value}`)}
            </button>
          ))}
        </fieldset>
        {mode !== 'animatic' && (
          <fieldset className="story__modes" aria-label={t('film.playback.size')}>
            {TILE_SIZES.map((value) => (
              <button
                type="button"
                key={value}
                className="story__mode"
                aria-pressed={size === value}
                aria-label={t(`film.playback.sizes.${value}`)}
                title={t(`film.playback.sizes.${value}`)}
                onClick={() => setSize(value)}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </fieldset>
        )}
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
        <Button
          icon="play"
          disabled={!visibleFrames.length}
          onClick={() => {
            setSelected(null);
            setPresent(true);
          }}
        >
          {t('film.playback.present')}
        </Button>
        {!readOnly && (
          <Button icon="plus" onClick={newScene}>
            {t('film.scene.add')}
          </Button>
        )}
      </div>
      <div className="story__main">
        {groups.length > 0 && (
          <SceneList groups={groups} filter={filter} onFilter={setSceneFilter} />
        )}
        <div className="story__scroll" data-scroll>
          {mode === 'animatic' && visibleFrames.length > 0 && (
            <Animatic
              key={filter ?? ''}
              store={store}
              frames={visibleFrames}
              labels={labels}
              boardAspect={boardAspect}
              readOnly={readOnly}
              suspended={present}
            />
          )}
          {mode === 'animatic' && groups.length > 0 && visibleFrames.length === 0 && (
            <div className="board-state">
              <EmptyState
                icon="storyboard"
                title={t('film.playback.noFrames')}
                actions={
                  !readOnly && (
                    <Button
                      variant="primary"
                      icon="plus"
                      onClick={() => newFrame(filter === LOOSE ? null : filter)}
                    >
                      {t('film.frame.add')}
                    </Button>
                  )
                }
              >
                {t('film.playback.noFramesBody')}
              </EmptyState>
            </div>
          )}
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
          {mode !== 'animatic' &&
            visible.map((g) => (
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
            userId={userId}
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
      {present && (
        <Animatic
          store={store}
          frames={visibleFrames}
          labels={labels}
          boardAspect={boardAspect}
          readOnly={readOnly}
          present
          onClose={() => setPresent(false)}
        />
      )}
      {drawn && (
        <DrawingEditor
          store={store}
          frame={drawn}
          label={labels.get(drawn.id) ?? ''}
          boardAspect={boardAspect}
          readOnly={readOnly}
          userId={userId}
          projectId={projectId}
          boardId={boardId}
          frames={frames}
          labels={labels}
          onPick={setDrawing}
          onClose={() => setDrawing(null)}
        />
      )}
    </div>
  );
}

/** Scenes with their frame count and how many are drawn; picking one shows only that scene. */
function SceneList({
  groups,
  filter,
  onFilter,
}: {
  groups: readonly SceneGroup[];
  filter: string | null;
  onFilter: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const frames = groups.reduce((n, g) => n + g.frames.length, 0);
  // The same estimate the animatic plays: frames without a duration count one second.
  const total = estimatedDurationMs(groups.flatMap((g) => g.frames));
  return (
    <nav className="story__sidebar" aria-label={t('film.playback.scenes')} data-scroll>
      <h2 className="story__sidebar-title">{t('film.playback.scenes')}</h2>
      <ul>
        <li>
          <button
            type="button"
            className="story__side-item"
            aria-pressed={filter === null}
            onClick={() => onFilter(null)}
          >
            <span className="story__side-name">{t('film.playback.allScenes')}</span>
            <span className="story__side-count">{frames}</span>
          </button>
        </li>
        {groups.map((g) => {
          const key = groupKey(g);
          const drawn = g.frames.filter(isDrawn).length;
          const count = g.frames.length;
          const progress = t('film.playback.drawn', { drawn, total: count });
          return (
            <li key={key}>
              <button
                type="button"
                className="story__side-item"
                aria-pressed={filter === key}
                onClick={() => onFilter(filter === key ? null : key)}
              >
                <span className="story__side-name">
                  {g.scene ? (
                    <>
                      <strong>{g.scene.number}</strong> {g.scene.title || t('film.scene.untitled')}
                    </>
                  ) : (
                    t('film.loose')
                  )}
                </span>
                <span className="story__side-count">{count}</span>
                <span className="story__sr">
                  {`, ${progress}, ${formatDuration(estimatedDurationMs(g.frames))}`}
                </span>
                <span className="story__side-bar" aria-hidden="true">
                  <span style={{ width: count ? `${(drawn / count) * 100}%` : 0 }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="story__side-total">
        {t('film.playback.estimated', { count: frames, duration: formatDuration(total) })}
      </p>
    </nav>
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
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);
  const collapsed = readOnly ? (localCollapsed ?? !!scene?.collapsed) : !!scene?.collapsed;
  const duration = formatDuration(estimatedDurationMs(frames));
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
    !readOnly && updateElement(store.doc, scene.id, patch, LOCAL);
  return (
    <section
      className="story__scene"
      aria-label={t('film.scene.heading', { number: scene.number })}
    >
      <header className="story__scene-head">
        <button
          type="button"
          className="column__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('film.scene.expand') : t('film.scene.collapse')}
          onClick={() => {
            if (readOnly) setLocalCollapsed(!collapsed);
            else set({ collapsed: collapsed ? undefined : true });
          }}
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
      {!collapsed && (
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
          shapes={frame.shapes}
          referenceOpacity={frame.referenceOpacity}
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
        <FrameVisibilityButton store={store} frame={frame} readOnly={readOnly} />
      </div>
      <CardReview elementId={frame.id} withPins={false} />
      {frame.action && <p className="story__tile-action">{frame.action}</p>}
    </li>
  );
});
