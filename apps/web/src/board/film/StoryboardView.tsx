import {
  addFrame,
  addScene,
  deleteElements,
  type FrameElement,
  isDrawn,
  moveFrames,
  type SceneElement,
  type SceneGroup,
  updateElement,
} from '@inkadra/canvas-core';
import { ASPECT_RATIOS, type AspectRatio, setBoardAspect } from '@inkadra/doc-schema';
import { Button, EmptyState, Icon, IconButton, Segmented, Select } from '@inkadra/ui';
import { type DragEvent, memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useRegisterActions } from '../../commands/actions.ts';
import { duplicateInStore } from '../../commands/board-actions.ts';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { CardReview } from '../CardReview.tsx';
import { ContextMenu, UploadPanel } from '../chrome.tsx';
import { Toast } from '../Toast.tsx';
import { GuestVisibility, GuestVisibilityIcon, toggleGuestHidden } from '../guest-visibility.tsx';
import { PresentationView } from '../PresentationView.tsx';
import { addScenePlan, plansOfScene, ScenePlanButton, useTakeParam } from '../plan/scenes.tsx';
import { openComments } from '../review-store.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { startUpload } from '../uploads.ts';
import { aspectLabel, useBoardAspect } from './aspect.ts';
import { DrawingEditor } from './DrawingEditor.tsx';
import { FramePanel } from './FramePanel.tsx';
import { FramePicture } from './FramePicture.tsx';
import { FrameVisibilityButton } from './FrameVisibilityButton.tsx';
import { blurOnEnter, StatusChip, usePresetText } from './fields.tsx';
import { inShotList, sceneName, useStoryboard } from './storyboard-data.ts';
import {
  applyDrop,
  type DropTarget,
  insertIndexAt,
  isFileDrag,
  splitDropped,
} from './storyboard-drop.ts';
import { ViewOptions } from './ViewOptions.tsx';

const FRAME_MIME = 'application/x-inkadra-frame';
const TILE_SIZES = ['s', 'm', 'l'] as const;
type TileSize = (typeof TILE_SIZES)[number];
const LOOSE = 'loose';

const groupKey = (g: SceneGroup) => g.scene?.id ?? LOOSE;

/** What the picture files being dragged over the storyboard would do, drawn before the drop. */
type FileMark =
  | { kind: 'replace'; frameId: string }
  | { kind: 'insert'; scene: string; index: number }
  | { kind: 'new-scene' };

const sameMark = (a: FileMark | null, b: FileMark | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === 'replace' ? a.frameId === (b as typeof a).frameId : true) &&
    (a.kind === 'insert'
      ? a.scene === (b as typeof a).scene && a.index === (b as typeof a).index
      : true));

export function StoryboardView({
  store,
  projectId,
  boardId,
  boardTitle = '',
  userId,
  readOnly,
  onExport,
  onExportFrame,
  onImportScript,
  ready = true,
}: {
  store: BoardStore;
  projectId: string;
  boardId: string;
  boardTitle?: string;
  userId: string;
  readOnly: boolean;
  /** Opens the export dialog on the storyboard. */
  onExport?: (() => void) | undefined;
  /** "Export image…" in a frame's menu. */
  onExportFrame?: ((frameId: string) => void) | undefined;
  /** Opens the screenplay import, which adds scenes and frames from a script file. */
  onImportScript?: (() => void) | undefined;
  /** False until the board has loaded: an empty storyboard may only be still arriving. */
  ready?: boolean;
}) {
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const { groups: allGroups, frames, labels } = useStoryboard(store);
  const omittedCount = allGroups.filter((g) => g.scene?.omitted).length;
  // Scenes the script left out stay in place, dimmed; the bar hides them (decision 0082).
  const [showOmitted, setShowOmitted] = useState(true);
  const groups = showOmitted ? allGroups : allGroups.filter((g) => !g.scene?.omitted);
  const [size, setSize] = useState<TileSize>('m');
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  // A plan's scene badge links to ?scene=<id>: bring that scene into view, once.
  const [sceneParam, takeSceneParam] = useTakeParam('scene');
  useEffect(() => {
    if (!sceneParam || !groups.some((g) => g.scene?.id === sceneParam)) return;
    takeSceneParam();
    document
      .querySelector(`[data-story-scene="${CSS.escape(sceneParam)}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, [sceneParam, takeSceneParam, groups]);
  // "Go to the card" of a comment, a search hit or a notification (decision 0121): a frame opens
  // selected and a scene comes into view; any other card is outside the storyboard, on its canvas.
  const [elParam, takeElParam] = useTakeParam('el');
  const [params, setParams] = useSearchParams();
  const sentToCanvas = params.get('view') === 'canvas';
  useEffect(() => {
    if (!elParam || !ready) return;
    const el = store.getSnapshot().byId.get(elParam);
    if (el && el.type !== 'frame' && el.type !== 'scene') {
      // A scene's plan opens in its editor; the canvas keeps `el` to select the card. Either
      // way the address changes once, so the effect does not run again on the same card.
      const scenePlan = el.type === 'plan' && !!el.sceneIds?.length;
      // Still here after asking for the canvas: this storyboard has none to open. Drop the card.
      if (!scenePlan && sentToCanvas) {
        takeElParam();
        return;
      }
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (scenePlan) {
            next.delete('el');
            next.set('plan', el.id);
          } else next.set('view', 'canvas');
          return next;
        },
        { replace: true },
      );
      return;
    }
    takeElParam();
    if (!el) return;
    if (el.type === 'frame') setSelected(el.id);
    document
      .querySelector(`[data-story-${el.type}="${CSS.escape(el.id)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [elParam, ready, store, setParams, takeElParam, sentToCanvas]);
  const [present, setPresent] = useState(false);
  // The board menu links to ?present=1 from any view: start once, when there is something to show.
  const [presentParam, takePresentParam] = useTakeParam('present');
  const hasFrames = frames.length > 0;
  useEffect(() => {
    if (!presentParam || (!ready && !hasFrames)) return;
    takePresentParam();
    if (!hasFrames) return;
    setSelected(null);
    setPresent(true);
  }, [presentParam, takePresentParam, ready, hasFrames]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ scene: string; index: number } | null>(null);
  const [fileMark, setFileMark] = useState<FileMark | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const { instance } = useSession();
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
  /** Deletes an omitted scene and its frames, after a named version to go back to. */
  const deleteScene = async (scene: SceneElement) => {
    try {
      await api.post(`/boards/${boardId}/versions`, {
        name: t('film.scene.deleteVersion', { number: scene.number }).slice(0, 120),
      });
    } catch {
      setToast(t('film.scene.deleteFailed'));
      return;
    }
    store.undo.stopCapturing();
    deleteElements(store.doc, [scene.id], LOCAL);
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
          ...(onImportScript
            ? [{ id: 'import-screenplay', label: t('screenplay.open'), run: onImportScript }]
            : []),
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

  /** Where files dropped at the pointer would go; null where nothing can be dropped. */
  function resolveDrop(e: DragEvent): { target: DropTarget; mark: FileMark } | null {
    const el = e.target instanceof Element ? e.target : null;
    const framePart = el?.closest<HTMLElement>('[data-story-frame]');
    if (framePart) {
      for (const g of groups) {
        const index = g.frames.findIndex((f) => f.id === framePart.dataset.storyFrame);
        const frame = g.frames[index];
        if (frame)
          return {
            target: { kind: 'replace', frameId: frame.id, sceneId: g.scene?.id ?? null, index },
            mark: { kind: 'replace', frameId: frame.id },
          };
      }
      return null;
    }
    if (!el?.closest('.story__scroll')) return null;
    const section = el.closest<HTMLElement>('[data-story-scene]');
    // Below the last scene, or in the empty storyboard, files go to the end.
    const group =
      visible.find((g) => groupKey(g) === section?.dataset.storyScene) ?? visible.at(-1);
    if (!group) return { target: { kind: 'new-scene' }, mark: { kind: 'new-scene' } };
    const boxes = section
      ? [...section.querySelectorAll('.story__tile')].map((tile) => tile.getBoundingClientRect())
      : [];
    // A collapsed scene shows no frames to aim at: it takes the files at its end.
    const index =
      !section || group.scene === null || boxes.length < group.frames.length
        ? group.frames.length
        : insertIndexAt(boxes, e.clientX, e.clientY);
    return {
      target: { kind: 'insert', sceneId: group.scene?.id ?? null, index },
      mark: { kind: 'insert', scene: groupKey(group), index },
    };
  }

  function onFileDragOver(e: DragEvent) {
    if (!isFileDrag([...e.dataTransfer.types])) return;
    // Cancelling the drag also keeps the browser from opening the file in place of the board.
    e.preventDefault();
    const hit = readOnly ? null : resolveDrop(e);
    e.dataTransfer.dropEffect = hit ? 'copy' : 'none';
    const mark = hit?.mark ?? null;
    setFileMark((prev) => (sameMark(prev, mark) ? prev : mark));
  }

  function onFileDrop(e: DragEvent) {
    if (!isFileDrag([...e.dataTransfer.types])) return;
    e.preventDefault();
    setFileMark(null);
    const hit = readOnly ? null : resolveDrop(e);
    if (!hit) return;
    const { images, skipped } = splitDropped([...e.dataTransfer.files]);
    if (skipped.length > 0) setToast(t('film.drop.notImage', { count: skipped.length }));
    const max = instance?.limits.uploadMaxBytes ?? 0;
    const tooBig = max > 0 ? images.filter((f) => f.size > max) : [];
    if (tooBig[0]) setToast(t('board.errors.tooBig', { name: tooBig[0].name }));
    applyDrop(
      store,
      hit.target,
      images.filter((f) => !tooBig.includes(f)),
      {
        userId,
        upload: (file, hooks) => startUpload({ file, projectId, boardId, ...hooks }),
        onFailed: (file) => setToast(t('board.errors.upload', { name: file.name })),
      },
    );
  }

  /** Where the insertion marker stands in a scene: a reorder in progress, or dropped files. */
  const markAt = (g: SceneGroup) =>
    drop?.scene === groupKey(g)
      ? drop.index
      : fileMark?.kind === 'insert' && fileMark.scene === groupKey(g)
        ? fileMark.index
        : null;

  // Size, aspect and total sit in the bar; on a phone they fold into View options.
  const sizeControl = (
    <Segmented
      label={t('film.playback.size')}
      value={size}
      onChange={setSize}
      options={TILE_SIZES.map((value) => ({
        value,
        label: value.toUpperCase(),
        tooltip: t(`film.playback.sizes.${value}`),
      }))}
    />
  );
  const aspectControl = (
    // biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button.
    <label className="story__aspect">
      <span>{t('film.aspect.label')}</span>
      <Select
        variant="quiet"
        className="ink-input"
        value={boardAspect}
        disabled={readOnly}
        onChange={(e) => setBoardAspect(store.doc, e as AspectRatio, LOCAL)}
      >
        {ASPECT_RATIOS.map((r) => (
          <option key={r} value={r}>
            {aspectLabel(r)}
          </option>
        ))}
      </Select>
    </label>
  );
  const totalLabel = (
    <span className="story__total">{t('film.total', { count: frames.length })}</span>
  );
  return (
    <div className={`story story--${size}`}>
      <div className="story__bar" data-chrome>
        <div className="view-options__inline">
          {sizeControl}
          {aspectControl}
          {totalLabel}
        </div>
        <span className="ink-header__spacer" />
        {omittedCount > 0 && (
          <Button
            icon={showOmitted ? 'eye' : 'eyeOff'}
            className="film-compact-btn"
            aria-pressed={showOmitted}
            aria-label={`${t('film.scene.omittedToggle')} (${omittedCount})`}
            data-ink-tooltip={t(showOmitted ? 'film.scene.hideOmitted' : 'film.scene.showOmitted')}
            onClick={() => setShowOmitted((v) => !v)}
          >
            <span className="film-compact-btn__label">
              <span className="story__omitted-word">{t('film.scene.omittedToggle')} </span>
              <span className="story__omitted-n">{omittedCount}</span>
            </span>
          </Button>
        )}
        <ViewOptions>
          {sizeControl}
          {aspectControl}
          {totalLabel}
        </ViewOptions>
        <Button
          icon="play"
          className="film-compact-btn"
          aria-label={t('film.playback.present')}
          disabled={!visibleFrames.length}
          onClick={() => {
            setSelected(null);
            setPresent(true);
          }}
        >
          <span className="film-compact-btn__label">{t('film.playback.present')}</span>
        </Button>
        {onExport && (
          <Button
            icon="download"
            className="film-compact-btn"
            aria-label={t('export.openPdf')}
            onClick={onExport}
          >
            <span className="film-compact-btn__label">{t('export.openPdf')}</span>
          </Button>
        )}
        {!readOnly && onImportScript && (
          <Button
            icon="upload"
            className="film-compact-btn"
            aria-label={t('screenplay.open')}
            data-ink-tooltip={t('screenplay.open')}
            data-tour="storyboard-import"
            onClick={onImportScript}
          >
            <span className="film-compact-btn__label">{t('screenplay.openShort')}</span>
          </Button>
        )}
        {!readOnly && (
          <Button
            icon="plus"
            className="film-compact-btn"
            aria-label={t('film.scene.add')}
            onClick={newScene}
          >
            <span className="film-compact-btn__label">{t('film.scene.add')}</span>
          </Button>
        )}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping picture files is a shortcut for "Upload an image" */}
      <div
        className="story__main"
        onDragOver={onFileDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileMark(null);
        }}
        onDrop={onFileDrop}
      >
        {groups.length > 0 && (
          <SceneList groups={groups} filter={filter} onFilter={setSceneFilter} />
        )}
        <div
          className={`story__scroll${fileMark?.kind === 'new-scene' ? ' is-drop' : ''}`}
          data-scroll
        >
          {groups.length === 0 && (
            <div className="board-state">
              <EmptyState
                icon="storyboard"
                title={t('film.empty.title')}
                actions={
                  !readOnly && (
                    <>
                      <Button variant="primary" icon="plus" onClick={newScene}>
                        {t('film.scene.add')}
                      </Button>
                      {onImportScript && (
                        <Button icon="upload" onClick={onImportScript}>
                          {t('screenplay.open')}
                        </Button>
                      )}
                    </>
                  )
                }
              >
                {t('film.empty.body')}
              </EmptyState>
            </div>
          )}
          {visible.map((g) => (
            <SceneSection
              key={g.scene?.id ?? 'loose'}
              group={g}
              store={store}
              readOnly={readOnly}
              userId={userId}
              onAddFrame={() => newFrame(g.scene?.id ?? null)}
              onDelete={deleteScene}
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
                  dropBefore={markAt(g) === i}
                  replacing={fileMark?.kind === 'replace' && fileMark.frameId === f.id}
                  onSelect={() => setSelected(f.id)}
                  onDraw={() => setDrawing(f.id)}
                  onExport={onExportFrame ? () => onExportFrame(f.id) : undefined}
                  userId={userId}
                  onDragOver={(e, after) => {
                    if (!g.scene || readOnly || isFileDrag([...e.dataTransfer.types])) return;
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
                    className={`story__add${markAt(g) === g.frames.length ? ' is-drop' : ''}`}
                    onClick={() => newFrame(g.scene?.id ?? null)}
                    onDragOver={(e) => {
                      if (!g.scene || isFileDrag([...e.dataTransfer.types])) return;
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
            key={current.id}
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
            dropping={fileMark?.kind === 'replace' && fileMark.frameId === current.id}
          />
        )}
      </div>
      <UploadPanel />
      {toast && <Toast text={toast} onClose={closeToast} />}
      {present && (
        <PresentationView
          store={store}
          projectId={projectId}
          groups={visible}
          labels={labels}
          boardTitle={boardTitle}
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
  const pickerId = useId();
  // Like the shot list, the total leaves out the frames of omitted scenes.
  const frames = inShotList(groups).reduce((n, g) => n + g.frames.length, 0);
  return (
    <>
      <label className="story__scene-picker" htmlFor={pickerId}>
        <span>{t('film.playback.scenes')}</span>
        <Select
          variant="quiet"
          id={pickerId}
          className="ink-input"
          value={filter ?? ''}
          onChange={(event) => onFilter(event || null)}
        >
          <option value="">
            {t('film.playback.allScenes')} · {frames}
          </option>
          {groups.map((group) => (
            <option key={groupKey(group)} value={groupKey(group)}>
              {group.scene
                ? `${group.scene.number} ${sceneName(group.scene) || t('film.scene.untitled')}`
                : t('film.loose')}{' '}
              · {group.frames.length}
            </option>
          ))}
        </Select>
      </label>
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
                  className={`story__side-item${g.scene?.omitted ? ' is-omitted' : ''}`}
                  aria-pressed={filter === key}
                  onClick={() => onFilter(filter === key ? null : key)}
                >
                  <span className="story__side-name">
                    {g.scene ? (
                      <>
                        <strong>{g.scene.number}</strong>{' '}
                        {sceneName(g.scene) || t('film.scene.untitled')}
                      </>
                    ) : (
                      t('film.loose')
                    )}
                  </span>
                  <span className="story__side-count">{count}</span>
                  <span className="story__sr">
                    {g.scene?.omitted
                      ? `, ${t('film.scene.omitted')}, ${progress}`
                      : `, ${progress}`}
                  </span>
                  <span className="story__side-bar" aria-hidden="true">
                    <span style={{ width: count ? `${(drawn / count) * 100}%` : 0 }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="story__side-total">{t('film.playback.summary', { count: frames })}</p>
      </nav>
    </>
  );
}

function SceneSection({
  group,
  store,
  readOnly,
  userId,
  onAddFrame,
  onDelete,
  children,
}: {
  group: SceneGroup;
  store: BoardStore;
  readOnly: boolean;
  userId: string;
  onAddFrame: () => void;
  /** Deletes an omitted scene and its frames, saving a version first. */
  onDelete: (scene: SceneElement) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { scene, frames } = group;
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);
  const collapsed = readOnly ? (localCollapsed ?? !!scene?.collapsed) : !!scene?.collapsed;
  if (!scene) {
    return (
      <section className="story__scene" data-story-scene={LOOSE}>
        <header className="story__scene-head">
          <span className="story__scene-title">{t('film.loose')}</span>
          <span className="story__scene-meta">{t('film.total', { count: frames.length })}</span>
        </header>
        <ul className="story__grid">{children}</ul>
      </section>
    );
  }
  const set = (patch: Partial<Omit<SceneElement, 'id' | 'type'>>) =>
    !readOnly && updateElement(store.doc, scene.id, patch, LOCAL);
  return (
    <section
      className={`story__scene${scene.omitted ? ' is-omitted' : ''}`}
      aria-label={t(scene.omitted ? 'film.scene.omittedHeading' : 'film.scene.heading', {
        number: scene.number,
      })}
      data-story-scene={scene.id}
    >
      <header className="story__scene-head" data-tour="storyboard-scene">
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
        {scene.omitted && <span className="story__omitted-badge">{t('film.scene.omitted')}</span>}
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
        <Select
          variant="quiet"
          className="ink-input story__scene-select"
          value={scene.setting ?? ''}
          disabled={readOnly}
          aria-label={t('film.scene.setting')}
          onChange={(e) => set({ setting: (e || undefined) as SceneElement['setting'] })}
        >
          <option value="">—</option>
          {(['int', 'ext', 'int-ext'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`film.scene.settings.${s}`)}
            </option>
          ))}
        </Select>
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
        <Select
          variant="quiet"
          className="ink-input story__scene-select"
          value={scene.time ?? ''}
          disabled={readOnly}
          aria-label={t('film.scene.time')}
          onChange={(e) => set({ time: (e || undefined) as SceneElement['time'] })}
        >
          <option value="">—</option>
          {(['day', 'night', 'dawn', 'dusk'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`film.scene.times.${s}`)}
            </option>
          ))}
        </Select>
        <input
          key={`t${scene.title}`}
          className="card__inline-input story__scene-title"
          defaultValue={scene.title}
          placeholder={t('film.scene.addTitle')}
          readOnly={readOnly}
          aria-label={t('film.scene.title')}
          onBlur={(e) => {
            const v = e.target.value.trim().slice(0, 200);
            if (v !== scene.title) set({ title: v });
          }}
          onKeyDown={blurOnEnter}
        />
        <span className="story__scene-meta">
          {scene.omitted && `${t('film.scene.notInScript')} · `}
          {t('film.total', { count: frames.length })}
        </span>
        <ScenePlanButton
          plans={plansOfScene(store.getSnapshot().byId.values(), scene.id)}
          onNew={readOnly ? undefined : () => addScenePlan(store, scene, userId)}
        />
        {/* An editor's pressed toggle already says the scene is hidden. */}
        {(readOnly || !scene.guestHidden) && <GuestVisibility store={store} element={scene} />}
        {!readOnly && scene.omitted && (
          <>
            <button
              ref={menuButton}
              type="button"
              className="ink-iconbtn"
              aria-label={t('film.scene.menu', { number: scene.number })}
              data-ink-tooltip={t('film.scene.menu', { number: scene.number })}
              aria-haspopup="menu"
              aria-expanded={!!menuAt}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenuAt((open) => (open ? null : { x: r.right - 230, y: r.bottom + 4 }));
              }}
            >
              <Icon name="more" size={16} />
            </button>
            {menuAt && (
              <ContextMenu
                style={{ position: 'fixed', left: Math.max(8, menuAt.x), top: menuAt.y }}
                anchor={menuButton}
                label={t('film.scene.menu', { number: scene.number })}
                onClose={(reason) => {
                  setMenuAt(null);
                  if (reason === 'escape') menuButton.current?.focus();
                }}
                items={[
                  {
                    label: t('film.scene.restore'),
                    content: (
                      <span className="story__menu-item">
                        {t('film.scene.restore')}
                        <small>{t('film.scene.restoreHint')}</small>
                      </span>
                    ),
                    action: () => {
                      store.undo.stopCapturing();
                      set({ omitted: undefined });
                    },
                  },
                  { divider: true },
                  {
                    label: t('film.scene.deleteAll'),
                    danger: true,
                    content: (
                      <span className="story__menu-item">
                        {t('film.scene.deleteAll')}
                        <small>{t('film.scene.deleteAllHint')}</small>
                      </span>
                    ),
                    action: () => onDelete(scene),
                  },
                ]}
              />
            )}
          </>
        )}
        {!readOnly && !scene.omitted && (
          <>
            <button
              type="button"
              className="ink-iconbtn guest-toggle"
              aria-label={t('guestVisibility.hide')}
              data-ink-tooltip={t('guestVisibility.hide')}
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
  replacing,
  onSelect,
  onDraw,
  onExport,
  userId,
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
  /** Image files are being dragged over the picture: dropping them replaces it. */
  replacing: boolean;
  onSelect: () => void;
  onDraw: () => void;
  onExport?: (() => void) | undefined;
  userId: string;
  onDragOver: (e: DragEvent, after: boolean) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const { t } = useTranslation();
  const presetText = usePresetText();
  const shot = presetText('shotSizes', frame.shot);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <li
      className={`story__tile${selected ? ' is-selected' : ''}${dropBefore ? ' is-drop' : ''}${replacing ? ' is-replace' : ''}`}
      data-tour="storyboard-frame"
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
      {(readOnly || !frame.guestHidden) && <GuestVisibility store={store} element={frame} />}
      <button
        type="button"
        className="story__tile-pic"
        data-story-frame={frame.id}
        data-tour="storyboard-draw"
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
        <StatusChip status={frame.status} />
        <FrameVisibilityButton store={store} frame={frame} readOnly={readOnly} />
        {onExport && (
          <button
            ref={menuButton}
            type="button"
            className="ink-iconbtn"
            aria-label={t('film.frame.menu', { label })}
            data-ink-tooltip={t('film.frame.menu', { label })}
            aria-haspopup="menu"
            aria-expanded={!!menuAt}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt((open) => (open ? null : { x: r.right - 208, y: r.bottom + 4 }));
            }}
          >
            <Icon name="more" size={16} />
          </button>
        )}
        {menuAt && onExport && (
          <ContextMenu
            style={{ position: 'fixed', left: Math.max(8, menuAt.x), top: menuAt.y }}
            anchor={menuButton}
            label={t('film.frame.menu', { label })}
            onClose={(reason) => {
              setMenuAt(null);
              if (reason === 'escape') menuButton.current?.focus();
            }}
            items={[
              { label: t('film.frame.open'), action: onSelect },
              ...(readOnly ? [] : [{ label: t('film.frame.status'), action: onSelect }]),
              { label: t('comments.open'), action: () => openComments({ elementId: frame.id }) },
              { divider: true },
              { label: t('export.openImage'), action: onExport },
              ...(readOnly
                ? []
                : [
                    {
                      label: t('film.frame.duplicate'),
                      action: () => duplicateInStore(store, [frame.id], userId),
                    },
                    { divider: true as const },
                    {
                      label: t('film.frame.delete'),
                      danger: true,
                      action: () => deleteElements(store.doc, [frame.id], LOCAL),
                    },
                  ]),
            ]}
          />
        )}
      </div>
      <CardReview elementId={frame.id} withPins={false} />
      {frame.action && <p className="story__tile-action">{frame.action}</p>}
    </li>
  );
});
