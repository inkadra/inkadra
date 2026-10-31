// SPDX-License-Identifier: AGPL-3.0-only

import {
  addFrame,
  addScene,
  deleteElements,
  duplicateElements,
  type FrameElement,
  formatDuration,
  moveFrames,
  updateElement,
} from '@inkadra/canvas-core';
import { SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES } from '@inkadra/doc-schema';
import { Button, Checkbox, EmptyState, Icon, Select } from '@inkadra/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassifications } from '../../lib/classifications.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { CardReview } from '../CardReview.tsx';
import { GuestVisibility } from '../guest-visibility.tsx';
import { insideDialog, isTyping } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { useBoardAspect } from './aspect.ts';
import { DrawingEditor } from './DrawingEditor.tsx';
import { estimatedDurationMs } from './duration.ts';
import { FramePanel } from './FramePanel.tsx';
import { FramePicture } from './FramePicture.tsx';
import { FrameVisibilityButton } from './FrameVisibilityButton.tsx';
import {
  blurOnEnter,
  PresetField,
  parseSeconds,
  StatusChip,
  StatusSelect,
  secondsText,
  usePresetText,
} from './fields.tsx';
import {
  getFrameStatus,
  type KanbanColumnKey,
  SHOT_DISPLAY_STATUSES,
  type ShotDisplayStatus,
} from './film-status.ts';
import { ShotlistKanban } from './ShotlistKanban.tsx';
import { useSlugline, useStoryboard } from './storyboard-data.ts';
import { ViewOptions } from './ViewOptions.tsx';

type Patch = Partial<Omit<FrameElement, 'id' | 'type'>>;

interface ShotGroup {
  id: string;
  title: string;
  scene?: ReturnType<typeof useStoryboard>['groups'][number]['scene'];
  frames: FrameElement[];
}

/** The shot list: the same frames as the storyboard, as a table or kanban. */
export function ShotList({
  store,
  boardTitle,
  projectId = '',
  boardId = '',
  userId = 'local',
  readOnly,
  onExport,
}: {
  store: BoardStore;
  boardTitle: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly: boolean;
  /** Opens the export dialog on the shot list. */
  onExport?: (() => void) | undefined;
}) {
  const { tagLabel } = useClassifications();
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const { groups, frames, labels } = useStoryboard(store);
  const slugline = useSlugline();
  const presetText = usePresetText();
  const phone = useIsPhone();
  const [mode, setMode] = useState<'table' | 'kanban'>('table');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ShotDisplayStatus | ''>('');
  const [selectedScene, setSelectedScene] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [selectedCast, setSelectedCast] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'scene' | 'location' | 'status' | 'none'>('scene');
  const [sortBy, setSortBy] = useState<'manual' | 'label' | 'duration'>('manual');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const opts = useMemo(() => ({ userId, origin: LOCAL }), [userId]);
  const currentFrame = frames.find((f) => f.id === selected) ?? null;
  // The shot card that opened the frame panel on a phone, to give focus back when it closes.
  const cardOrigin = useRef<string | null>(null);
  useEffect(() => {
    const origin = cardOrigin.current;
    if (selected === origin) return;
    cardOrigin.current = null;
    if (selected !== null || !origin) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-shot-card="${CSS.escape(origin)}"]`)
      ?.focus();
  }, [selected]);
  const drawn = frames.find((f) => f.id === drawing) ?? null;

  const scenes = useMemo(
    () => groups.map((g) => g.scene).filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [groups],
  );

  const allLocations = useMemo(
    () =>
      [
        ...new Set(frames.map((f) => f.location?.trim()).filter((l): l is string => Boolean(l))),
      ].sort(),
    [frames],
  );

  const allCast = useMemo(
    () =>
      [
        ...new Set(
          frames
            .flatMap((f) => f.cast ?? [])
            .map((c) => c.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [frames],
  );

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (f: FrameElement, sceneId?: string | null) => {
      if (status && getFrameStatus(f) !== status) return false;
      if (selectedScene) {
        const frameScene = sceneId ?? f.parent ?? null;
        if (frameScene !== selectedScene) return false;
      }
      if (selectedLocation) {
        if ((f.location ?? '').trim().toLowerCase() !== selectedLocation.toLowerCase()) {
          return false;
        }
      }
      if (selectedCast) {
        if (!(f.cast ?? []).some((c) => c.trim().toLowerCase() === selectedCast.toLowerCase())) {
          return false;
        }
      }
      if (q) {
        const haystacks = [
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
          ...(f.tags ?? []).map(tagLabel),
        ];
        if (!haystacks.some((v) => v?.toLowerCase().includes(q))) return false;
      }
      return true;
    },
    [status, selectedScene, selectedLocation, selectedCast, q, labels, presetText, tagLabel],
  );

  const sortFrames = useCallback(
    (items: FrameElement[]) => {
      if (sortBy === 'manual') return items;
      return [...items].sort((a, b) => {
        if (sortBy === 'label') {
          const la = labels.get(a.id) ?? a.label ?? '';
          const lb = labels.get(b.id) ?? b.label ?? '';
          return la.localeCompare(lb, undefined, { numeric: true });
        }
        if (sortBy === 'duration') {
          return (b.durationMs ?? 0) - (a.durationMs ?? 0);
        }
        return 0;
      });
    },
    [sortBy, labels],
  );

  const shownGroups = useMemo<ShotGroup[]>(() => {
    if (groupBy === 'scene') {
      return groups
        .map((g) => ({
          id: g.scene?.id ?? 'loose',
          title: g.scene
            ? `${g.scene.number} ${slugline(g.scene)} ${g.scene.title ?? ''}`.trim()
            : t('film.loose'),
          scene: g.scene,
          frames: sortFrames(g.frames.filter((f) => matches(f, g.scene?.id))),
        }))
        .filter((g) => g.frames.length > 0);
    }
    const filtered = frames.filter((f) => matches(f));
    if (groupBy === 'location') {
      const map = new Map<string, FrameElement[]>();
      for (const f of filtered) {
        const loc = f.location?.trim() || t('film.list.noLocation');
        if (!map.has(loc)) map.set(loc, []);
        map.get(loc)?.push(f);
      }
      return Array.from(map.entries()).map(([loc, grpFrames]) => ({
        id: `loc-${loc}`,
        title: loc,
        frames: sortFrames(grpFrames),
      }));
    }
    if (groupBy === 'status') {
      const map = new Map<string, FrameElement[]>();
      for (const f of filtered) {
        const s = getFrameStatus(f);
        if (!map.has(s)) map.set(s, []);
        map.get(s)?.push(f);
      }
      return Array.from(map.entries()).map(([st, grpFrames]) => ({
        id: `status-${st}`,
        title: t(`film.status.${st}`),
        frames: sortFrames(grpFrames),
      }));
    }
    return [
      {
        id: 'all',
        title: t('film.list.allScenes'),
        frames: sortFrames(filtered),
      },
    ];
  }, [groupBy, groups, frames, matches, sortFrames, slugline, t]);

  const allFilteredFrames = useMemo(() => shownGroups.flatMap((g) => g.frames), [shownGroups]);

  const allVisibleFrameIds = useMemo(() => allFilteredFrames.map((f) => f.id), [allFilteredFrames]);

  // Prune selection when visible frames change (due to filters, grouping, search, etc.)
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleSet = new Set(allVisibleFrameIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allVisibleFrameIds]);

  const visibleSelectedIds = useMemo(() => {
    const visibleSet = new Set(allVisibleFrameIds);
    return Array.from(selectedIds).filter((id) => visibleSet.has(id));
  }, [selectedIds, allVisibleFrameIds]);

  const allSelected =
    allVisibleFrameIds.length > 0 && allVisibleFrameIds.every((id) => selectedIds.has(id));
  const someSelected = allVisibleFrameIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of allVisibleFrameIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of allVisibleFrameIds) next.add(id);
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const set = (id: string, patch: Patch) => !readOnly && updateElement(store.doc, id, patch, LOCAL);

  const addFrameToScene = (sceneId?: string | null) => {
    if (readOnly) return;
    store.undo.stopCapturing();
    let targetSceneId = sceneId;
    if (!targetSceneId) {
      targetSceneId = groups[0]?.scene?.id ?? null;
      if (!targetSceneId) {
        const s = addScene(store.doc, {}, opts);
        targetSceneId = s.id;
      }
    }
    const f = addFrame(store.doc, targetSceneId, null, {}, opts);
    setSelected(f.id);
  };

  const addFrameInStatus = (targetCol: KanbanColumnKey) => {
    if (readOnly) return;
    store.undo.stopCapturing();
    let sceneId = groups[0]?.scene?.id ?? null;
    if (!sceneId) {
      const s = addScene(store.doc, {}, opts);
      sceneId = s.id;
    }
    const fields =
      targetCol === 'approved'
        ? { approved: true }
        : { status: targetCol === 'todo' ? undefined : targetCol };
    const f = addFrame(store.doc, sceneId, null, fields, opts);
    setSelected(f.id);
  };

  const bulkChangeStatus = (targetStatus: ShotDisplayStatus) => {
    if (readOnly || visibleSelectedIds.length === 0) return;
    store.undo.stopCapturing();
    store.doc.transact(() => {
      for (const id of visibleSelectedIds) {
        if (targetStatus === 'approved') {
          updateElement(store.doc, id, { approved: true }, LOCAL);
        } else {
          updateElement(store.doc, id, { status: targetStatus, approved: false }, LOCAL);
        }
      }
    }, LOCAL);
  };

  const bulkMoveToScene = (targetSceneId: string) => {
    if (readOnly || visibleSelectedIds.length === 0 || !targetSceneId) return;
    store.undo.stopCapturing();
    moveFrames(store.doc, visibleSelectedIds, targetSceneId, 0, LOCAL);
  };

  const bulkDelete = () => {
    if (readOnly || visibleSelectedIds.length === 0) return;
    store.undo.stopCapturing();
    deleteElements(store.doc, new Set(visibleSelectedIds), LOCAL);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleSelectedIds) next.delete(id);
      return next;
    });
    if (selected && visibleSelectedIds.includes(selected)) setSelected(null);
  };

  const bulkDuplicate = useCallback(() => {
    if (readOnly || visibleSelectedIds.length === 0) return;
    store.undo.stopCapturing();
    const newIds = duplicateElements(store.doc, visibleSelectedIds, { x: 0, y: 0 }, opts);
    setSelectedIds(new Set(newIds));
  }, [readOnly, visibleSelectedIds, store, opts]);

  useEffect(() => {
    if (mode !== 'table') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Row checkboxes keep the shortcut; real text fields don't.
      const checkbox = e.target instanceof HTMLInputElement && e.target.type === 'checkbox';
      if (isTyping(e.target) && !checkbox) return;
      if (insideDialog(e.target)) return;

      const hasSelection = visibleSelectedIds.length > 0;
      const root = containerRef.current;
      const hasFocus = Boolean(
        root && (root.contains(document.activeElement) || root.contains(e.target as Node)),
      );

      if (!hasSelection || !hasFocus) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!readOnly) {
          e.preventDefault();
          bulkDuplicate();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, visibleSelectedIds, readOnly, bulkDuplicate]);

  const toggleCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const statusCounts = useMemo(() => {
    const counts = { shot: 0, todo: 0, retake: 0, approved: 0 };
    for (const f of allFilteredFrames) {
      const s = getFrameStatus(f);
      if (s === 'shot') counts.shot++;
      else if (s === 'retake') counts.retake++;
      else if (s === 'approved') counts.approved++;
      else counts.todo++;
    }
    return counts;
  }, [allFilteredFrames]);

  const hasActiveFilters = Boolean(status || selectedScene || selectedLocation || selectedCast);

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
        t(`film.status.${getFrameStatus(f)}`),
        (f.tags ?? []).map(tagLabel).join(', '),
      ]),
    );
    downloadCsv(`${boardTitle || 'shotlist'}.csv`, [head, ...rows]);
  }

  const selectedSceneObj = scenes.find((s) => s.id === selectedScene);

  // Filters, grouping, sorting and export sit in the bar; on a phone they fold into View options.
  const filterControls = (
    <>
      <Select
        className="ink-input"
        value={selectedScene}
        aria-label={t('film.list.groupScene')}
        onChange={(e) => setSelectedScene(e)}
      >
        <option value="">{t('film.list.allScenes')}</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.number ? `${s.number}. ` : ''}
            {s.title || slugline(s)}
          </option>
        ))}
      </Select>

      {allLocations.length > 0 && (
        <Select
          className="ink-input"
          value={selectedLocation}
          aria-label={t('film.list.groupLocation')}
          onChange={(e) => setSelectedLocation(e)}
        >
          <option value="">{t('film.list.allLocations')}</option>
          {allLocations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      )}

      {allCast.length > 0 && (
        <Select
          className="ink-input"
          value={selectedCast}
          aria-label={t('film.frame.cast')}
          onChange={(e) => setSelectedCast(e)}
        >
          <option value="">{t('film.list.allCast')}</option>
          {allCast.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}

      <Select
        className="ink-input"
        value={status}
        aria-label={t('film.frame.status')}
        onChange={(e) => setStatus(e as ShotDisplayStatus | '')}
      >
        <option value="">{t('film.list.allStatuses')}</option>
        {SHOT_DISPLAY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`film.status.${s}`)}
          </option>
        ))}
      </Select>

      <Select
        className="ink-input"
        value={groupBy}
        aria-label={t('film.list.groupBy')}
        onChange={(e) => setGroupBy(e as 'scene' | 'location' | 'status' | 'none')}
      >
        <option value="scene">
          {t('film.list.groupBy')}: {t('film.list.groupScene')}
        </option>
        <option value="location">
          {t('film.list.groupBy')}: {t('film.list.groupLocation')}
        </option>
        <option value="status">
          {t('film.list.groupBy')}: {t('film.list.groupStatus')}
        </option>
        <option value="none">
          {t('film.list.groupBy')}: {t('film.list.groupNone')}
        </option>
      </Select>

      <Select
        className="ink-input"
        value={sortBy}
        aria-label={t('film.list.sortBy')}
        onChange={(e) => setSortBy(e as 'manual' | 'label' | 'duration')}
      >
        <option value="manual">
          {t('film.list.sortBy')}: {t('film.list.sortManual')}
        </option>
        <option value="label">
          {t('film.list.sortBy')}: {t('film.list.sortLabel')}
        </option>
        <option value="duration">
          {t('film.list.sortBy')}: {t('film.list.sortDuration')}
        </option>
      </Select>
    </>
  );
  const exportButton = (
    <>
      <Button icon="download" disabled={frames.length === 0} onClick={exportCsv}>
        {t('film.list.export')}
      </Button>
      {onExport && (
        <Button icon="download" onClick={onExport}>
          {t('export.openPdf')}
        </Button>
      )}
    </>
  );

  const groupHeading = (g: ShotGroup, isCollapsed: boolean) => {
    const grpCounts = { shot: 0, todo: 0, retake: 0, approved: 0 };
    for (const f of g.frames) {
      const s = getFrameStatus(f);
      if (s === 'shot') grpCounts.shot++;
      else if (s === 'retake') grpCounts.retake++;
      else if (s === 'approved') grpCounts.approved++;
      else grpCounts.todo++;
    }
    return (
      <>
        <button
          type="button"
          className="shots__group-toggle"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t('film.list.expandGroup') : t('film.list.collapseGroup')}
          onClick={() => toggleCollapse(g.id)}
        >
          {isCollapsed ? '▸' : '▾'}
        </button>
        {g.scene ? (
          <>
            <span className="shots__scene-number">{g.scene.number}</span>
            <GuestVisibility store={store} element={g.scene} />
            {slugline(g.scene)}
            {g.scene.title && <span className="shots__scene-title">{g.scene.title}</span>}
          </>
        ) : (
          <span>{g.title}</span>
        )}
        <span className="shots__scene-meta">
          {t('film.total', {
            count: g.frames.length,
            duration: formatDuration(estimatedDurationMs(g.frames)),
          })}
        </span>
        <span className="shots__group-pills">
          {grpCounts.shot > 0 && (
            <span className="shots__group-pill shots__group-pill--shot">
              {grpCounts.shot} {t('film.status.shot').toLowerCase()}
            </span>
          )}
          {grpCounts.todo > 0 && (
            <span className="shots__group-pill shots__group-pill--todo">
              {grpCounts.todo} {t('film.status.todo').toLowerCase()}
            </span>
          )}
          {grpCounts.retake > 0 && (
            <span className="shots__group-pill shots__group-pill--retake">
              {grpCounts.retake} {t('film.status.retake').toLowerCase()}
            </span>
          )}
          {grpCounts.approved > 0 && (
            <span className="shots__group-pill shots__group-pill--approved">
              {grpCounts.approved} {t('film.status.approved').toLowerCase()}
            </span>
          )}
        </span>
      </>
    );
  };

  const canAddInGroup = (g: ShotGroup) => !readOnly && (groupBy === 'scene' || !g.scene);
  const addShotButton = (g: ShotGroup) => (
    <button
      type="button"
      className="shots__add-row-btn"
      onClick={() => addFrameToScene(g.scene?.id)}
    >
      +{' '}
      {g.scene
        ? t('film.list.addShotInScene', { scene: g.scene.number ?? g.title })
        : t('film.list.addShot')}
    </button>
  );

  // On a phone each shot is a card; its other fields are edited in the frame panel.
  const shotCards = (
    <div className="shot-cards">
      {!readOnly && allVisibleFrameIds.length > 0 && (
        <label className="shot-cards__select-all">
          <span className="shot-cards__select-all-box">
            <Checkbox
              className="shots__checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={toggleSelectAll}
            />
          </span>
          {t('film.list.selectAll')}
        </label>
      )}
      {shownGroups.map((g) => {
        const isCollapsed = collapsedGroups.has(g.id);
        return (
          <section key={g.id} className="shot-cards__group">
            <h3 className="shot-cards__scene">{groupHeading(g, isCollapsed)}</h3>
            {!isCollapsed && (
              <ul className="shot-cards__list">
                {g.frames.map((f) => {
                  const label = labels.get(f.id) ?? '';
                  const isOpen = selected === f.id;
                  const isChecked = selectedIds.has(f.id);
                  const meta = [
                    presetText('film.shot', SHOT_SIZES, f.shot),
                    f.lens,
                    f.durationMs !== undefined ? `${secondsText(f.durationMs)}s` : '',
                  ].filter(Boolean);
                  return (
                    <li
                      key={f.id}
                      className={`shot-card${isOpen || isChecked ? ' is-selected' : ''}`}
                    >
                      {!readOnly && (
                        <label className="shot-card__check">
                          <Checkbox
                            className="shots__checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(f.id)}
                            aria-label={t('film.list.selectRow', { label })}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="shot-card__body"
                        data-shot-card={f.id}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? 'shot-frame-panel' : undefined}
                        onClick={() => {
                          cardOrigin.current = isOpen ? null : f.id;
                          setSelected(isOpen ? null : f.id);
                        }}
                      >
                        <span className="shot-card__pic">
                          <FramePicture
                            assetId={f.assetId}
                            aspect={f.aspect}
                            boardAspect={boardAspect}
                            strokes={f.strokes}
                            shapes={f.shapes}
                            referenceOpacity={f.referenceOpacity}
                            pixels={240}
                          />
                        </span>
                        <span className="shot-card__text">
                          <span className="shot-card__head">
                            <b className="shot-card__label">{label}</b>
                            <StatusChip status={getFrameStatus(f)} />
                          </span>
                          {meta.length > 0 && (
                            <span className="shot-card__meta">{meta.join(' · ')}</span>
                          )}
                          {f.action && <span className="shot-card__action">{f.action}</span>}
                        </span>
                      </button>
                      <span className="shot-card__marks">
                        <GuestVisibility store={store} element={f} />
                        <CardReview elementId={f.id} withPins={false} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {!isCollapsed && canAddInGroup(g) && (
              <div className="shot-cards__add">{addShotButton(g)}</div>
            )}
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="shots" ref={containerRef}>
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
            <span className="shots__mode-label">{t('film.list.table')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'kanban'}
            className="view-tabs__tab"
            onClick={() => setMode('kanban')}
          >
            <Icon name="board" size={14} />
            <span className="shots__mode-label">{t('film.list.kanban')}</span>
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

        <div className="view-options__inline">{filterControls}</div>

        <span className="ink-header__spacer" />

        <ViewOptions>
          {filterControls}
          {exportButton}
        </ViewOptions>

        {!readOnly && (
          <Button
            icon="plus"
            variant="primary"
            className="film-compact-btn"
            aria-label={t('film.list.addShot')}
            onClick={() => addFrameToScene(null)}
          >
            <span className="film-compact-btn__label">{t('film.list.addShot')}</span>
          </Button>
        )}

        <div className="view-options__inline">{exportButton}</div>
      </div>

      {hasActiveFilters && (
        <div
          className="shots__chips"
          style={{ padding: '6px 20px', borderBottom: '1px solid var(--ink-border-subtle)' }}
        >
          {selectedScene && (
            <span className="shots__chip">
              {selectedSceneObj
                ? `${selectedSceneObj.number}. ${selectedSceneObj.title || slugline(selectedSceneObj)}`
                : t('film.list.groupScene')}
              <button
                type="button"
                className="shots__chip-remove"
                aria-label={t('film.list.removeFilter')}
                onClick={() => setSelectedScene('')}
              >
                ×
              </button>
            </span>
          )}
          {selectedLocation && (
            <span className="shots__chip">
              {selectedLocation}
              <button
                type="button"
                className="shots__chip-remove"
                aria-label={t('film.list.removeFilter')}
                onClick={() => setSelectedLocation('')}
              >
                ×
              </button>
            </span>
          )}
          {selectedCast && (
            <span className="shots__chip">
              {selectedCast}
              <button
                type="button"
                className="shots__chip-remove"
                aria-label={t('film.list.removeFilter')}
                onClick={() => setSelectedCast('')}
              >
                ×
              </button>
            </span>
          )}
          {status && (
            <span className="shots__chip">
              {t(`film.status.${status}`)}
              <button
                type="button"
                className="shots__chip-remove"
                aria-label={t('film.list.removeFilter')}
                onClick={() => setStatus('')}
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      <div className="story__main">
        <div className="shots__scroll" data-scroll>
          {frames.length === 0 ? (
            <div className="board-state">
              <EmptyState icon="shotlist" title={t('film.list.empty')}>
                {t('film.empty.body')}
              </EmptyState>
            </div>
          ) : shownGroups.length === 0 ? (
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
          ) : phone ? (
            shotCards
          ) : (
            <table className="shots__table">
              <thead>
                <tr>
                  {!readOnly && (
                    <th className="shots__select-col">
                      <Checkbox
                        className="shots__checkbox"
                        onClick={(e) => e.stopPropagation()}
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={toggleSelectAll}
                        aria-label={t('film.list.selectAll')}
                      />
                    </th>
                  )}
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
                  <th>{t('film.frame.cast')}</th>
                  <th>{t('film.frame.status')}</th>
                </tr>
              </thead>
              {shownGroups.map((g) => {
                const isCollapsed = collapsedGroups.has(g.id);

                return (
                  <tbody key={g.id}>
                    <tr className="shots__scene">
                      <th colSpan={readOnly ? 12 : 13} scope="rowgroup">
                        {groupHeading(g, isCollapsed)}
                      </th>
                    </tr>
                    {!isCollapsed &&
                      g.frames.map((f) => {
                        const isSelectedRow = selectedIds.has(f.id);
                        const label = labels.get(f.id) ?? '';
                        return (
                          <tr
                            key={f.id}
                            className={
                              selected === f.id || isSelectedRow ? 'is-selected' : undefined
                            }
                            onClick={() => setSelected((s) => (s === f.id ? null : f.id))}
                          >
                            {!readOnly && (
                              <td className="shots__select-col">
                                <Checkbox
                                  className="shots__checkbox"
                                  checked={isSelectedRow}
                                  onChange={() => toggleSelect(f.id)}
                                  aria-label={t('film.list.selectRow', { label })}
                                />
                              </td>
                            )}
                            <td className="shots__pic-col">
                              <FramePicture
                                assetId={f.assetId}
                                aspect={f.aspect}
                                boardAspect={boardAspect}
                                strokes={f.strokes}
                                shapes={f.shapes}
                                referenceOpacity={f.referenceOpacity}
                                pixels={240}
                              />
                              <CardReview elementId={f.id} withPins={false} />
                            </td>
                            <td className="shots__label">
                              {label}{' '}
                              {(readOnly || !f.guestHidden) && (
                                <GuestVisibility store={store} element={f} />
                              )}
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
                                onCommit={(v) =>
                                  set(f.id, { lens: v.trim().slice(0, 60) || undefined })
                                }
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
                                  set(f.id, {
                                    location: v.trim().slice(0, 200) || undefined,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <Cell
                                label={t('film.frame.cast')}
                                value={(f.cast ?? []).join(', ')}
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
                                  set(f.id, { cast: cast.length > 0 ? cast : undefined });
                                }}
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
                        );
                      })}
                    {!isCollapsed && canAddInGroup(g) && (
                      <tr className="shots__add-row">
                        <td colSpan={readOnly ? 12 : 13}>{addShotButton(g)}</td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          )}
        </div>

        {/* On a phone the open frame panel covers the list, and the toolbar would cover it. */}
        {visibleSelectedIds.length > 0 && !readOnly && !(phone && currentFrame) && (
          <div
            role="toolbar"
            aria-label={t('film.list.bulkActions')}
            className="shots__bulk-toolbar"
          >
            <b>{t('film.list.selectedCount', { count: visibleSelectedIds.length })}</b>
            <Select
              aria-label={t('film.list.changeStatus')}
              value=""
              onChange={(e) => {
                const nextStatus = e as ShotDisplayStatus;
                if (nextStatus) bulkChangeStatus(nextStatus);
              }}
            >
              <option value="" disabled>
                {t('film.list.changeStatus')} ▾
              </option>
              {SHOT_DISPLAY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`film.status.${s}`)}
                </option>
              ))}
            </Select>

            {scenes.length > 0 && (
              <Select
                aria-label={t('film.list.moveToScene')}
                value=""
                onChange={(e) => {
                  const sceneId = e;
                  if (sceneId) bulkMoveToScene(sceneId);
                }}
              >
                <option value="" disabled>
                  {t('film.list.moveToScene')} ▾
                </option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number ? `${s.number}. ` : ''}
                    {s.title || slugline(s)}
                  </option>
                ))}
              </Select>
            )}

            <button
              type="button"
              className="shots__bulk-btn shots__bulk-btn--danger"
              onClick={bulkDelete}
            >
              {t('film.list.deleteSelected')}
            </button>
            <button
              type="button"
              className="shots__bulk-close"
              aria-label={t('film.list.deselectAll')}
              onClick={() => setSelectedIds(new Set())}
            >
              ×
            </button>
          </div>
        )}

        {currentFrame && (
          <FramePanel
            store={store}
            userId={userId}
            frame={currentFrame}
            label={labels.get(currentFrame.id) ?? ''}
            boardAspect={boardAspect}
            projectId={projectId}
            boardId={boardId}
            readOnly={readOnly}
            id="shot-frame-panel"
            takeFocus={phone && cardOrigin.current === currentFrame.id}
            onClose={() => setSelected(null)}
            onDraw={() => setDrawing(currentFrame.id)}
          />
        )}
      </div>

      <footer className="shots__footer">
        <span>
          <b>{t('film.list.totalShots', { count: allFilteredFrames.length })}</b>
        </span>
        <span>
          {t('film.list.estimatedDuration')}{' '}
          <b>{formatDuration(estimatedDurationMs(allFilteredFrames))}</b>
        </span>
        <span className="shots__footer-dots">
          {statusCounts.shot > 0 && (
            <span className="shots__footer-dot-item">
              <span className="shots__footer-dot shots__footer-dot--shot" />
              {statusCounts.shot} {t('film.status.shot').toLowerCase()}
            </span>
          )}
          {statusCounts.todo > 0 && (
            <span className="shots__footer-dot-item">
              <span className="shots__footer-dot shots__footer-dot--todo" />
              {statusCounts.todo} {t('film.status.todo').toLowerCase()}
            </span>
          )}
          {statusCounts.retake > 0 && (
            <span className="shots__footer-dot-item">
              <span className="shots__footer-dot shots__footer-dot--retake" />
              {statusCounts.retake} {t('film.status.retake').toLowerCase()}
            </span>
          )}
          {statusCounts.approved > 0 && (
            <span className="shots__footer-dot-item">
              <span className="shots__footer-dot shots__footer-dot--approved" />
              {statusCounts.approved} {t('film.status.approved').toLowerCase()}
            </span>
          )}
        </span>
      </footer>

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
