import {
  listElements,
  placeProductionCard,
  type Rect,
  storyboardOf as sceneGroups,
} from '@inkadra/canvas-core';
import {
  atLeast,
  type Board,
  type BoardCount,
  type BoardDetail,
  type BoardOptionalView,
  defaultProjectIcon,
  moduleOf,
  type Project,
  type ProjectRole,
} from '@inkadra/shared';
import { Avatar, Button, EmptyState, Icon, IconButton, ProjectGlyph } from '@inkadra/ui';
import {
  Fragment,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useRegisterActions } from '../commands/actions.ts';
import { setFeedbackConnection } from '../feedback/diagnostics.ts';
import { openFeedback, useFeedbackStatus } from '../feedback/state.ts';
import { api } from '../lib/api.ts';
import { useHeaderContent } from '../lib/header.tsx';
import { MODULE_GLYPHS, setModule, useModules } from '../lib/modules.ts';
import { useIsPhone } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';
import { moveTabFocus } from '../lib/tabs.ts';
import { useProjects } from '../routes/AppLayout.tsx';
import { NotFound } from '../routes/NotFound.tsx';
import { ProjectAppearanceDialog } from '../routes/ProjectAppearance.tsx';
import { renameProject } from '../routes/projects.ts';
import { BOARD_CARD_SIZE } from './BoardCardPreview.tsx';
import {
  boardPath,
  canRenameBoard,
  createBoard,
  fetchBoard,
  productionOf,
  renameBoard,
  setBoardIcon,
  setBoardViews,
  useProjectBoards,
} from './boards.ts';
import { Canvas } from './Canvas.tsx';
import { CommentsButton, useCardLabel } from './CommentsPanel.tsx';
import { ContextMenu, type MenuItem, Toast } from './chrome.tsx';
import { type BoardConnection, useBoardConnection } from './connection.ts';
import { DeniedState } from './DeniedState.tsx';
import { ExportDialog } from './export/ExportDialog.tsx';
import type { ExportWhat } from './export/engine.ts';
import type { ExportSource } from './export/settings.ts';
import { ClientReviewView } from './film/ClientReviewView.tsx';
import { MoodboardView } from './film/MoodboardView.tsx';
import { useDaysPointingAt } from './film/production-days.ts';
import { ScheduleView } from './film/ScheduleView.tsx';
import { ShotList } from './film/ShotList.tsx';
import { StoryboardView } from './film/StoryboardView.tsx';
import type { ScheduleSources } from './film/schedule-sources.tsx';
import { createScreenplayStoryboard } from './film/screenplay/new-storyboard.ts';
import { applyImport, type ImportPlan } from './film/screenplay/plan.ts';
import { applyRevision, revisionCounts } from './film/screenplay/revision.ts';
import {
  type ImportTarget,
  type RevisionChoice,
  ScreenplayImportDialog,
} from './film/screenplay/ScreenplayImportDialog.tsx';
import { shootingZone } from './film/sun.ts';
import { TroupeView } from './film/TroupeView.tsx';
import { boardPeople, EditingLine, editingPeople, SyncStatus } from './header-status.tsx';
import { useLiveBoardCounts } from './live-counts.ts';
import { RestoredToast } from './RestoredToast.tsx';
import { isMac } from './shortcuts.ts';
import { LOCAL } from './store.ts';
import { type VersionPreview, VersionsDialog } from './VersionsDialog.tsx';
import { beginViewSwitch, slideTabPill, type ViewSwitchMotion } from './view-switch.ts';
import {
  type BoardView,
  boardViews,
  defaultView,
  hasOutsideCards,
  headerViews,
  isBoardView,
  kindIcon,
  offeredViews,
  openView,
  viewHref,
  viewIcon,
  viewLabelKey,
  viewsOn,
} from './views.ts';
import './film/film.css';
import { ScenePlan } from './plan/ScenePlan.tsx';
import { type Peer, usePeers } from './presence.ts';
import { missingOwnedBoard, projectLanding } from './project-landing.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { useBoardReviews } from './use-board-reviews.ts';
import './board.css';

const canEdit = (role: ProjectRole | null | undefined) => role === 'owner' || role === 'editor';

export { type BoardView, VIEWS } from './views.ts';

/**
 * A board opens on the view of its kind; `?view=` picks another of its views (decision 0121).
 * An address that asks for a view the board does not have opens its first view.
 */
export function useBoardView(
  board: Pick<Board, 'kind' | 'views'> | undefined,
  counts: Parameters<typeof openView>[2],
  production?: boolean,
): [BoardView, (v: BoardView, motion?: ViewSwitchMotion) => void] {
  const [params, setParams] = useSearchParams();
  const kind = board?.kind;
  const view: BoardView =
    openView(params.get('view'), board, counts, production) ?? defaultView(kind);
  const setView = useCallback(
    (v: BoardView, motion?: ViewSwitchMotion) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (v === defaultView(kind)) next.delete('view');
          else next.set('view', v);
          return next;
        },
        { replace: true, ...motion },
      ),
    [kind, setParams],
  );
  return [view, setView];
}

/** /p/:projectId shows the root board, /p/:projectId/b/:boardId a nested one. */
export function BoardPage() {
  const { projectId, boardId: param } = useParams();
  const { projects, shared } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  if (!projectId || !projects) return null;
  const landing = param ? null : projectLanding(projectId, projects, shared);
  if (landing?.kind === 'loading') return null;
  if (landing?.kind === 'notFound') return <NotFound />;
  if (landing?.kind === 'shared')
    return <Navigate to={boardPath(projectId, landing.boardId)} replace />;
  const boardId = param ?? project?.rootBoardId;
  if (!boardId) return null;
  // People with access to some boards only are not project members: their breadcrumb starts at
  // the top board shared with them.
  return (
    <BoardScreen
      key={boardId}
      projectId={projectId}
      projectName={project?.name ?? ''}
      projectIcon={project?.icon}
      rootBoardId={project?.rootBoardId}
      projectRole={project?.myRole ?? null}
      projectTimeZone={project?.timeZone}
      boardId={boardId}
    />
  );
}

function CurrentCrumb({
  title,
  ariaLabel,
  maxLength,
  canRename,
  editing,
  setEditing,
  onRename,
}: {
  title: string;
  ariaLabel?: string;
  maxLength: number;
  canRename: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  onRename: (title: string) => void;
}) {
  const { t } = useTranslation();
  const cancelledRef = useRef(false);

  if (!canRename) {
    return (
      <span className="crumb crumb--current" aria-current="page">
        {title}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        className="crumb crumb--current crumb__input"
        defaultValue={title}
        maxLength={maxLength}
        // biome-ignore lint/a11y/noAutofocus: opened explicitly by user click to rename
        autoFocus
        onFocus={(e) => {
          cancelledRef.current = false;
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          const cancelled = cancelledRef.current;
          cancelledRef.current = false;
          setEditing(false);
          if (cancelled) return;
          const value = e.target.value.trim();
          if (value && value !== title) {
            onRename(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={ariaLabel ?? t('board.board.title')}
      />
    );
  }

  return (
    <button
      type="button"
      className="crumb crumb--current crumb--editable"
      aria-current="page"
      onClick={() => setEditing(true)}
    >
      {title}
    </button>
  );
}

/**
 * "Views of this board" in the ⋯ menu (decision 0121): the view of its kind, ticked and fixed,
 * then the views it may turn on, ticked when on. A view of a module that is off is offered only
 * while it is on, so it can be turned off.
 */
function viewItems(
  board: Pick<Board, 'kind' | 'views'>,
  counts: BoardCount | undefined,
  toggle: (view: BoardOptionalView) => void,
  t: (key: string) => string,
  off: readonly string[],
  production: boolean,
): MenuItem[] {
  const on = viewsOn(board, counts, production);
  const optional = offeredViews(board, counts, off, production);
  return [
    { heading: t('board.views.title') },
    ...boardViews({ kind: board.kind, views: [] }, counts).map(
      (v): MenuItem => ({
        label: t(`film.views.${v}`),
        icon: viewIcon(v),
        kind: v,
        checked: true,
        toggle: true,
        disabled: true,
        hint: t('board.views.always'),
      }),
    ),
    ...optional.map(
      (v): MenuItem => ({
        label: t(`film.views.${v}`),
        icon: viewIcon(v),
        kind: v,
        checked: on.includes(v),
        toggle: true,
        action: () => toggle(v),
      }),
    ),
    ...(optional.length === 0 ? [{ label: t('board.views.none'), disabled: true }] : []),
    { note: t('board.views.note') },
    { divider: true },
  ];
}

/** The bar of a board's views in the header. */
function ViewTabs({
  id,
  kind,
  tabs,
  view,
  onChoose,
}: {
  /** Names the tabs `${id}-${view}` and the view they control `${id}-panel`. */
  id: string;
  kind: Board['kind'] | undefined;
  tabs: BoardView[];
  view: BoardView;
  onChoose: (view: BoardView) => void;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => slideTabPill(list.current, view), [view]);
  return (
    <div
      ref={list}
      className="view-tabs"
      role="tablist"
      data-tour="views"
      aria-label={t('film.views.label')}
      // The arrows walk the tabs; Enter and Space pick one, as on any button.
      onKeyDown={moveTabFocus}
    >
      <span className="view-tabs__pill" aria-hidden="true" />
      {tabs.map((v) => (
        <button
          key={v}
          id={`${id}-${v}`}
          type="button"
          role="tab"
          aria-selected={view === v}
          aria-controls={`${id}-panel`}
          tabIndex={view === v ? 0 : -1}
          className="view-tabs__tab"
          // On narrow desktops only the open tab keeps its name: the rest say it on hover.
          aria-label={t(viewLabelKey(v, kind))}
          data-ink-tooltip={t(viewLabelKey(v, kind))}
          // Focus on press would scroll a tab cut off by the strip out from under the
          // pointer: the release lands on its neighbour and the click is lost.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.currentTarget.focus({ preventScroll: true });
            onChoose(v);
          }}
        >
          <Icon name={viewIcon(v)} contentKind={v} size={14} />
          <span className="view-tabs__label">{t(viewLabelKey(v, kind))}</span>
        </button>
      ))}
    </div>
  );
}

function BoardScreen({
  projectId,
  projectName,
  projectIcon,
  rootBoardId,
  projectRole,
  projectTimeZone,
  boardId,
}: {
  projectId: string;
  projectName: string;
  projectIcon?: Project['icon'] | undefined;
  rootBoardId: string | undefined;
  projectRole: ProjectRole | null;
  /** The clock of the shooting times (decision 0061), for sunrise and sunset. */
  projectTimeZone?: string | undefined;
  boardId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  // The counts the sidebar reads, so the header never disagrees with it on a board's views.
  const { boardCounts, projects } = useProjects();
  // The project's dates for the schedule. The page waits for the list; a grant on one board has
  // no project in it, so its dates are unavailable rather than loading forever.
  const listed = projects?.find((p) => p.id === projectId);
  const datesStatus = !projects ? 'loading' : listed ? 'ready' : 'unavailable';
  const { items: boards, error: boardsError } = useProjectBoards(projectId);
  const conn = useBoardConnection(boardId);
  useEffect(() => {
    if (!conn) return;
    return setFeedbackConnection(() => ({
      sync: `${conn.status} · pending changes: ${conn.saves.get().pending}`,
      flags: `readOnly: ${conn.readOnly} · schemaTooNew: ${!!conn.schemaTooNew}`,
    }));
  }, [conn]);
  useLiveBoardCounts(conn, boardId);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  // The list follows a change of views at once; the detail stands in for a board not in it.
  const board = boards?.find((b) => b.id === boardId) ?? detail ?? undefined;
  const kind = board?.kind;
  const { off: modulesOff, isOn } = useModules();
  /** The module of this board's kind, when this person turned it off (decision 0121). */
  const offModule = kind ? moduleOf('kinds', kind) : null;
  const moduleOff = offModule && !isOn(offModule) ? offModule : null;
  const counts = boardCounts.get(boardId);
  // The project's Production board (decision 0123), when the person can see it.
  const production = productionOf(boards);
  const hasProduction = !!production;
  const [view, setView] = useBoardView(board, counts, hasProduction);
  const [openedFilmViews, setOpenedFilmViews] = useState({ schedule: false, troupe: false });
  // On the Production board the calendar stays open behind Troupe too: its Export reads the
  // storyboards the calendar opened (decision 0123).
  const [scheduleSources, setScheduleSources] = useState<ScheduleSources | null>(null);
  // A storyboard's ⋯ menu leads to the Production board that plans it.
  const pointing = useDaysPointingAt(boardId, kind === 'storyboard' ? production?.id : undefined);
  useEffect(() => {
    if (view === 'schedule' || view === 'troupe')
      setOpenedFilmViews((opened) => (opened[view] ? opened : { ...opened, [view]: true }));
  }, [view]);
  const [sharing, setSharing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [iconBoard, setIconBoard] = useState<Board | null>(null);
  const reportingOn = !!useFeedbackStatus()?.enabled;
  const isPhone = useIsPhone();
  const tabsId = useId();
  const liveSelection = useRef<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState<{
    source: ExportSource;
    what?: ExportWhat;
    imageEntry?: boolean;
    pdfEntry?: boolean;
    selection: ReadonlySet<string>;
    visible: Rect | null;
  } | null>(null);
  const visibleRef = useRef<(() => Rect | null) | null>(null);
  // Selection and visible area are read when the dialog opens, not followed afterwards.
  const openExport = useCallback((source: ExportSource, what?: ExportWhat, pdfEntry?: boolean) => {
    const content = what ?? (source === 'production' ? 'callsheets' : undefined);
    setExporting({
      source,
      ...(content ? { what: content } : {}),
      ...(pdfEntry ? { pdfEntry } : {}),
      selection: liveSelection.current,
      visible: visibleRef.current?.() ?? null,
    });
  }, []);
  const exportSelection = useCallback(() => {
    setExporting({
      source: 'canvas',
      what: 'selection',
      imageEntry: true,
      selection: liveSelection.current,
      visible: visibleRef.current?.() ?? null,
    });
  }, []);
  // The Storyboard has no selection of its own: its menu names the frame.
  const exportFrame = useCallback((id: string) => {
    setExporting({
      source: 'storyboard',
      what: 'selection',
      imageEntry: true,
      selection: new Set([id]),
      visible: null,
    });
  }, []);
  const exportStoryboard = useCallback(
    () => openExport('storyboard', undefined, true),
    [openExport],
  );
  const exportShotList = useCallback(() => openExport('shotlist', undefined, true), [openExport]);
  const [importingScript, setImportingScript] = useState(false);
  const openScriptImport = useCallback(() => setImportingScript(true), []);
  const [scriptToast, setScriptToast] = useState<string | null>(null);
  const closeScriptToast = useCallback(() => setScriptToast(null), []);
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const rememberSelection = useCallback((ids: ReadonlySet<string>) => {
    liveSelection.current = ids;
  }, []);
  const previewStore = preview?.store;
  useEffect(
    () => () => {
      previewStore?.destroy();
      previewStore?.doc.destroy();
    },
    [previewStore],
  );
  const editable = !!conn && !conn.readOnly && canEdit(detail?.myRole ?? projectRole);
  // The Production board's document holds nothing: no versions to offer (decision 0123).
  const versionable = editable && kind !== 'production';
  // Every view is one of the open board's: choosing one changes the address of this board only.
  const chooseView = useCallback(
    (next: BoardView) => setView(next, beginViewSwitch(view, next)),
    [setView, view],
  );

  /** Opens the storyboard and starts its presentation, which StoryboardView reads from the URL. */
  const startPresentation = useCallback(() => {
    const href = viewHref(projectId, { id: boardId, kind }, 'storyboard', rootBoardId);
    navigate(
      `${href}${href.includes('?') ? '&' : '?'}present=1`,
      beginViewSwitch(view, 'storyboard'),
    );
  }, [boardId, kind, rootBoardId, navigate, projectId, view]);

  // The counts change with every edit: the tabs depend on what they decide, so the palette's
  // actions below are not registered again each time.
  const tabKey = headerViews(board, counts, view, hasProduction).join();
  const tabs = useMemo(() => (tabKey ? (tabKey.split(',') as BoardView[]) : []), [tabKey]);
  // Optional views on and off, for the ⋯ menu; editors only (decision 0121).
  const viewsKey = board ? viewsOn(board, counts, hasProduction).join() : '';
  const toggleView = useCallback(
    (v: BoardOptionalView) => {
      if (!board) return;
      const on = viewsKey ? (viewsKey.split(',') as BoardOptionalView[]) : [];
      const next = on.includes(v) ? on.filter((x) => x !== v) : [...on, v];
      void setBoardViews(projectId, boardId, next)
        .then((b) => setDetail((prev) => (prev && prev.id === b.id ? { ...prev, ...b } : prev)))
        .catch(() => {});
    },
    [board, viewsKey, projectId, boardId],
  );
  // On a storyboard, the cards other than its scenes and frames: its old canvas shows them.
  const outside = kind === 'storyboard' ? (counts?.looseCount ?? 0) : 0;
  const openOutside = useCallback(
    () => setView('canvas', beginViewSwitch(view, 'canvas')),
    [setView, view],
  );
  // Send to storyboard asks which one when the project has several (decision 0121).
  const storyboards = useMemo(
    () => (boards ?? []).filter((b) => b.kind === 'storyboard' && b.id !== boardId),
    [boards, boardId],
  );
  const newStoryboard = useCallback(
    async () =>
      (
        await createBoard(
          projectId,
          rootBoardId ?? boardId,
          t('film.views.storyboard'),
          'storyboard',
        )
      ).id,
    [projectId, rootBoardId, boardId, t],
  );

  // The palette offers a view only when the header shows its tab.
  useRegisterActions(
    conn?.status !== 'synced'
      ? []
      : [
          ...(tabs.length > 1 ? tabs : []).map((target) => ({
            id: `view-${target}`,
            label: t(viewLabelKey(target, kind)),
            run: () => chooseView(target),
          })),
          ...(versionable
            ? [{ id: 'versions', label: t('versions.title'), run: () => setVersionsOpen(true) }]
            : []),
          ...(detail ? [{ id: 'share', label: t('share.open'), run: () => setSharing(true) }] : []),
        ],
  );
  useEffect(() => {
    if (!editable) {
      setVersionsOpen(false);
      setPreview(null);
    }
  }, [editable]);
  const headerMenuAnchor = useRef<HTMLDivElement>(null);
  // An outside click leaves focus where the person clicked; Escape and a chosen item return it.
  const closeHeaderMenu = useCallback((reason: 'escape' | 'outside' | 'item') => {
    setHeaderMenu(false);
    if (reason !== 'outside') document.getElementById('board-header-menu')?.focus();
  }, []);
  const showPreview = useCallback((value: VersionPreview | null) => {
    setPreview(value);
    if (!value) requestAnimationFrame(() => document.getElementById('board-header-menu')?.focus());
  }, []);
  const clearUndo = useCallback(() => conn?.store.undo.clear(), [conn]);
  const handleRenameCurrentBoard = useCallback(
    (newTitle: string) => {
      if (boardId === rootBoardId) {
        void renameProject(projectId, newTitle)
          .then((p) => {
            setDetail((prev) =>
              prev && prev.id === rootBoardId ? { ...prev, title: p.name } : prev,
            );
          })
          .catch(() => {});
      } else {
        void renameBoard(projectId, boardId, newTitle)
          .then((b) => {
            setDetail((prev) => (prev && prev.id === b.id ? { ...prev, title: b.title } : prev));
          })
          .catch(() => {});
      }
    },
    [projectId, boardId, rootBoardId],
  );

  // Read again when the server changes our access, so the role shown and checked is current.
  const accessVersion = conn?.accessChangedAt;
  useEffect(() => {
    let alive = true;
    void accessVersion;
    fetchBoard(boardId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [boardId, accessVersion]);

  // The card of a sub-board opens the view it shows (decision 0121); the board page falls back
  // to the board's first view when that one is off.
  const openBoard = useCallback(
    (id: string, view?: string) => {
      const target = boards?.find((b) => b.id === id);
      navigate(
        target && view && isBoardView(view)
          ? viewHref(projectId, target, view, rootBoardId)
          : boardPath(projectId, id, rootBoardId),
      );
    },
    [navigate, projectId, rootBoardId, boards],
  );
  // The card of a Production board made under the root without one (the move of an existing
  // project, the project ⋯ menu): placed once by the first editor who opens the root board
  // (decision 0123, answer 2).
  const placeCard =
    conn?.status === 'synced' &&
    editable &&
    !preview &&
    boardId === rootBoardId &&
    production?.parentBoardId === rootBoardId
      ? production.id
      : null;
  useEffect(() => {
    if (!conn || !placeCard) return;
    placeProductionCard(conn.store.doc, placeCard, BOARD_CARD_SIZE, {
      userId: user?.id ?? null,
      origin: LOCAL,
    });
  }, [conn, placeCard, user]);
  useBoardReviews(boardId, conn, detail?.myRole ?? projectRole, {
    preview: !!preview,
    canvas: view === 'canvas',
  });

  const crumbs = useMemo(
    () => breadcrumb(boardId, rootBoardId, projectName, detail, boards),
    [boardId, rootBoardId, projectName, detail, boards],
  );
  const crumbTitles = useMemo(() => crumbs.map((c) => c.title), [crumbs]);
  // The storyboard as it is when the import opens: an update from a revision matches against it.
  const scriptStoryboard = useMemo(
    () => ({
      title: crumbs.at(-1)?.title ?? detail?.title ?? '',
      groups: importingScript && conn ? sceneGroups(listElements(conn.store.doc)) : [],
    }),
    [importingScript, conn, crumbs, detail],
  );

  /** Appends to this storyboard as one undo step, or makes a new one beside it and opens it. */
  const importScript = useCallback(
    async (plan: ImportPlan, target: ImportTarget, revision?: RevisionChoice) => {
      if (!conn || !user) return;
      if (target === 'revise' && revision) {
        // The version comes first: without it the update does not happen (decision 0082).
        if (revision.version)
          await api.post(`/boards/${boardId}/versions`, { name: revision.version });
        const scenes = sceneGroups(listElements(conn.store.doc)).flatMap((g) =>
          g.scene ? [g.scene] : [],
        );
        conn.store.undo.stopCapturing();
        applyRevision(conn.store.doc, revision.rows, plan.scenes, scenes, revision.options, {
          userId: user.id,
          origin: LOCAL,
        });
        conn.store.undo.stopCapturing();
        const n = revisionCounts(revision.rows, plan.scenes, revision.options);
        setScriptToast(
          t('screenplay.revision.done', {
            updated: t('screenplay.revision.updated', { count: n.updated }),
            added: t('screenplay.revision.added', { count: n.added }),
            omitted: t('screenplay.revision.omitted', { count: n.omitted }),
          }),
        );
        return;
      }
      if (target === 'append') {
        conn.store.undo.stopCapturing();
        applyImport(conn.store.doc, plan, { userId: user.id, origin: LOCAL });
        conn.store.undo.stopCapturing();
        // The storyboard has no undo shortcut of its own: the toast takes the import back.
        setScriptToast(
          t('screenplay.imported', {
            scenes: t('screenplay.scenes', { count: plan.scenes.length }),
            frames: t('screenplay.framesCount', { count: plan.frameCount }),
          }),
        );
        return;
      }
      const board = await createScreenplayStoryboard(
        projectId,
        detail?.parentBoardId ?? rootBoardId ?? boardId,
        plan,
        t('screenplay.untitled'),
        user.id,
      );
      void openBoard(board.id);
    },
    [conn, user, projectId, detail, rootBoardId, boardId, t, openBoard],
  );

  const selfId = user?.id ?? null;
  const canRenameCurrent = editable && (boardId !== rootBoardId || canEdit(projectRole));
  // The root board's icon is the project's, which the sidebar changes.
  const currentBoard = boards?.find((b) => b.id === boardId);
  const iconTarget =
    editable && boardId !== rootBoardId && canRenameBoard(currentBoard) ? currentBoard : undefined;
  const canPresent = tabs.includes('storyboard');
  const importable = kind === 'storyboard' && !preview;

  const missing =
    conn?.status === 'denied' && missingOwnedBoard(projectRole, boards, boardsError, boardId);
  const productionLink = kind === 'storyboard' && !!production && (pointing ?? 0) > 0;
  const header = useMemo(
    () => ({
      start: (
        <>
          <nav aria-label={t('nav.breadcrumb')} className="ink-header__crumbs" data-feedback-secret>
            {/* The project's glyph before its name; phones show the last crumb only. */}
            {projectIcon && crumbs[0]?.id === rootBoardId && <ProjectGlyph {...projectIcon} />}

            {crumbs.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && (
                  <span className="crumb__sep" aria-hidden="true">
                    /
                  </span>
                )}
                {/* A sub-board shows its kind before its name, with the icon of the sidebar. */}
                {i === crumbs.length - 1 && c.id !== rootBoardId && kind && (
                  <Icon name={kindIcon(kind)} contentKind={kind} size={14} />
                )}
                {i === crumbs.length - 1 ? (
                  <CurrentCrumb
                    title={c.title}
                    ariaLabel={c.id === rootBoardId ? t('project.name') : t('board.board.title')}
                    // The limits of UpdateProject.name and UpdateBoard.title.
                    maxLength={c.id === rootBoardId ? 120 : 200}
                    canRename={canRenameCurrent}
                    editing={renaming}
                    setEditing={setRenaming}
                    onRename={handleRenameCurrentBoard}
                  />
                ) : (
                  <a
                    className="crumb"
                    href={boardPath(projectId, c.id, rootBoardId)}
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
                      openBoard(c.id);
                    }}
                  >
                    {c.title}
                  </a>
                )}
              </Fragment>
            ))}
          </nav>
          {tabs.length > 1 && (
            <ViewTabs id={tabsId} kind={kind} tabs={tabs} view={view} onChoose={chooseView} />
          )}
          {(editable || outside > 0 || productionLink) && (
            <div className="board-header-menu" ref={headerMenuAnchor}>
              <IconButton
                id="board-header-menu"
                data-tour="board-menu"
                icon="more"
                label={t('versions.boardMenu')}
                aria-haspopup="menu"
                aria-expanded={headerMenu}
                onClick={() => setHeaderMenu((v) => !v)}
              />
              {headerMenu && (
                <ContextMenu
                  onClose={closeHeaderMenu}
                  anchor={headerMenuAnchor}
                  items={[
                    ...(editable && board
                      ? viewItems(board, counts, toggleView, t, modulesOff, hasProduction)
                      : []),
                    // "Shooting days: 3 · Open Production" (decision 0123).
                    ...(productionLink && production
                      ? [
                          {
                            label: t('production.storyboardLink', { count: pointing ?? 0 }),
                            icon: 'film' as const,
                            kind: 'production' as const,
                            action: () =>
                              navigate(viewHref(projectId, production, 'schedule', rootBoardId)),
                          },
                          { divider: true as const },
                        ]
                      : []),
                    ...(outside > 0
                      ? [
                          {
                            label: t('board.outside.menu', { count: outside }),
                            icon: 'board' as const,
                            checked: view === 'canvas' ? true : undefined,
                            action: openOutside,
                          },
                          ...(editable ? [{ divider: true as const }] : []),
                        ]
                      : []),
                    // Readers get only the way to the cards outside the storyboard.
                    ...(editable
                      ? ([
                          ...(canRenameCurrent
                            ? [
                                {
                                  label: t('board.menu.rename'),
                                  icon: 'pen' as const,
                                  action: () => setRenaming(true),
                                },
                              ]
                            : []),
                          ...(iconTarget
                            ? [
                                {
                                  label: t('board.menu.boardIcon'),
                                  icon: 'iconLibrary' as const,
                                  action: () => setIconBoard(iconTarget),
                                },
                              ]
                            : []),
                          ...(canRenameCurrent || iconTarget ? [{ divider: true as const }] : []),
                          ...(importable
                            ? [
                                {
                                  label: t('screenplay.open'),
                                  icon: 'upload' as const,
                                  action: openScriptImport,
                                },
                              ]
                            : []),
                          {
                            label: t(
                              kind === 'production'
                                ? 'export.whatCallsheets'
                                : 'board.export.action',
                            ),
                            icon: 'download' as const,
                            action: () => openExport(exportSourceOf(view, kind)),
                          },
                          ...(canPresent
                            ? [
                                {
                                  label: t('board.present.action'),
                                  icon: 'play' as const,
                                  action: startPresentation,
                                },
                              ]
                            : []),
                          ...(versionable
                            ? [
                                {
                                  label: t('versions.title'),
                                  icon: 'clock' as const,
                                  action: () => setVersionsOpen(true),
                                },
                              ]
                            : []),
                          ...(reportingOn
                            ? [
                                { divider: true as const },
                                {
                                  label: t('feedback.title'),
                                  icon: 'report' as const,
                                  ...(isPhone
                                    ? {}
                                    : { shortcut: isMac() ? '⌘⇧B' : 'Ctrl+Shift+B' }),
                                  action: () => openFeedback(),
                                },
                              ]
                            : []),
                        ] as MenuItem[])
                      : []),
                  ]}
                />
              )}
            </div>
          )}
        </>
      ),
      end: (
        <>
          {conn && !missing && <BoardPresence conn={conn} selfId={selfId} />}
          {editable && (
            <>
              {versionable && (
                <IconButton
                  icon="clock"
                  label={t('versions.title')}
                  onClick={() => setVersionsOpen(true)}
                />
              )}
              <IconButton
                icon="download"
                className="board-header-export"
                label={t(kind === 'production' ? 'export.whatCallsheets' : 'board.export.action')}
                onClick={() => openExport(exportSourceOf(view, kind))}
              />
              {/* The Storyboard view has its own Presenta button, with the same name. */}
              {canPresent && view !== 'storyboard' && (
                <IconButton
                  icon="play"
                  className="board-header-present"
                  label={t('board.present.action')}
                  onClick={startPresentation}
                />
              )}
            </>
          )}
          {(editable || detail) && <span className="ink-header__divider" aria-hidden="true" />}
          <CommentsButton />
          {detail && (
            <Button
              variant={
                detail.myRole === 'owner' || detail.myRole === 'editor' ? 'primary' : 'secondary'
              }
              icon="people"
              className="board-share"
              data-tour="share"
              aria-label={t('share.open')}
              onClick={() => setSharing(true)}
            >
              <span className="board-share__label">{t('share.open')}</span>
            </Button>
          )}
        </>
      ),
    }),
    [
      crumbs,
      missing,
      t,
      projectId,
      rootBoardId,
      openBoard,
      conn,
      tabs,
      view,
      chooseView,
      detail,
      editable,
      headerMenu,
      reportingOn,
      isPhone,
      closeHeaderMenu,
      openExport,
      handleRenameCurrentBoard,
      canRenameCurrent,
      renaming,
      iconTarget,
      importable,
      openScriptImport,
      canPresent,
      startPresentation,
      selfId,
      projectIcon,
      tabsId,
      board,
      counts,
      kind,
      toggleView,
      modulesOff,
      outside,
      openOutside,
      hasProduction,
      versionable,
      productionLink,
      production,
      pointing,
      navigate,
    ],
  );
  useHeaderContent(header);

  if (!conn || !user) return null;
  if (conn.status === 'signedOut') return <SignedOut />;
  const shareDialog = detail && (
    <ShareDialog
      open={sharing}
      board={{ ...detail, title: crumbs.at(-1)?.title ?? detail.title }}
      subBoards={countBelow(boardId, boards)}
      onClose={() => setSharing(false)}
    />
  );
  if (conn.status === 'denied') {
    // Only owners have a complete list, including restricted boards. Outsiders keep the
    // same denial for missing and inaccessible boards; no existence probe is added.
    return missing ? <NotFound /> : <DeniedState />;
  }
  const versions = versionable && (
    <VersionsDialog
      open={versionsOpen}
      provider={conn.provider}
      store={conn.store}
      editable={editable}
      boardId={boardId}
      onClose={() => setVersionsOpen(false)}
      preview={preview}
      onPreview={showPreview}
      onRestored={clearUndo}
    />
  );
  const content =
    view === 'storyboard' ? (
      <StoryboardView
        key={preview?.version.id ?? 'live'}
        store={preview?.store ?? conn.store}
        projectId={projectId}
        boardId={boardId}
        boardTitle={crumbs.at(-1)?.title ?? detail?.title ?? ''}
        userId={user.id}
        readOnly={!!preview || !editable}
        onExport={exportStoryboard}
        onExportFrame={exportFrame}
        onImportScript={openScriptImport}
        ready={conn.status === 'synced'}
      />
    ) : view === 'shotlist' ? (
      <ShotList
        key={preview?.version.id ?? 'live'}
        store={preview?.store ?? conn.store}
        boardTitle={crumbs.at(-1)?.title ?? ''}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        readOnly={!!preview || !editable}
        onExport={exportShotList}
      />
    ) : view === 'schedule' || view === 'troupe' ? null : view === 'review' ? (
      <ClientReviewView
        key={preview?.version.id ?? 'live'}
        store={preview?.store ?? conn.store}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        readOnly={!!preview || !editable}
      />
    ) : view === 'moodboard' ? (
      <MoodboardView
        key={preview?.version.id ?? 'live'}
        store={preview?.store ?? conn.store}
        projectId={projectId}
        userId={user.id}
        readOnly={!!preview || !editable}
        boardTitle={crumbs.at(-1)?.title ?? detail?.title ?? ''}
        storyboards={storyboards}
        onNewStoryboard={rootBoardId ? newStoryboard : undefined}
      />
    ) : preview ? (
      <Canvas
        key={preview.version.id}
        conn={{ ...conn, store: preview.store, readOnly: true }}
        preview
        breadcrumb={crumbTitles}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        boards={boards}
        canEdit={false}
        peers={[]}
        onOpenBoard={() => {}}
      />
    ) : (
      <BoardCanvas
        initialSelection={liveSelection.current}
        onSelectionChange={rememberSelection}
        onExportSelection={exportSelection}
        visibleRef={visibleRef}
        conn={conn}
        breadcrumb={crumbTitles}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        boards={boards}
        canEdit={canEdit(detail?.myRole ?? projectRole)}
        onOpenBoard={openBoard}
      />
    );
  return (
    <div
      className={preview ? 'board-preview' : undefined}
      style={preview ? undefined : { display: 'contents' }}
      // The view under the header's tabs is their panel; phones pick views from a menu instead.
      {...(!isPhone && tabs.includes(view)
        ? { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': `${tabsId}-${view}` }
        : {})}
    >
      {conn.schemaTooNew && (
        <div role="alert" className="board-update-notice">
          {t('board.contextual.updateApp')}
        </div>
      )}
      {moduleOff && !preview && (
        <p className="board-module-off" role="note">
          <span style={MODULE_GLYPHS[moduleOff].style} aria-hidden="true">
            <Icon name={MODULE_GLYPHS[moduleOff].icon} size={14} />
          </span>
          {t('modules.offLine', { name: t(`modules.names.${moduleOff}`) })}
          <Button
            variant="secondary"
            onClick={() => void setModule(moduleOff, true).catch(() => {})}
          >
            {t('modules.turnOn')}
          </Button>
        </p>
      )}
      {versions}
      {/* Keep drafts and their saves alive while another view is selected. */}
      {(openedFilmViews.schedule || view === 'schedule' || kind === 'production') && (
        <div
          style={{ display: view === 'schedule' ? 'contents' : 'none' }}
          inert={view !== 'schedule'}
        >
          <ScheduleView
            active={view === 'schedule'}
            key={`${boardId}-${preview?.version.id ?? 'live'}`}
            store={preview?.store ?? conn.store}
            boardTitle={crumbs.at(-1)?.title ?? ''}
            projectName={projectName}
            projectId={projectId}
            timeZone={shootingZone(projectTimeZone)}
            shootingStart={listed?.shootingStart}
            datesStatus={datesStatus}
            canEditCrew={!!projectRole && atLeast(projectRole, 'editor')}
            boardId={boardId}
            userId={user.id}
            readOnly={!!preview || !editable}
            boards={boards}
            across={kind === 'production'}
            onSources={kind === 'production' ? setScheduleSources : undefined}
            onOpenScene={(sceneId, from) =>
              navigate(
                `${from === boardId ? '' : boardPath(projectId, from, rootBoardId)}?view=storyboard&scene=${encodeURIComponent(sceneId)}`,
              )
            }
            onOpenTroupe={() => navigate('?view=troupe')}
          />
        </div>
      )}
      {(openedFilmViews.troupe || view === 'troupe') && (
        <div style={{ display: view === 'troupe' ? 'contents' : 'none' }} inert={view !== 'troupe'}>
          <TroupeView
            key={projectId}
            store={conn.store}
            projectId={projectId}
            boardId={boardId}
            readOnly={!!preview || !editable}
          />
        </div>
      )}
      {content}
      {/* A scene's set plan opens on its own wherever there is no canvas around it. */}
      {view !== 'canvas' && !preview && (
        <ScenePlan
          store={conn.store}
          projectId={projectId}
          boardId={boardId}
          userId={user.id}
          readOnly={!editable}
          ready={conn.status === 'synced'}
        />
      )}
      {shareDialog}
      {iconBoard && (
        <ProjectAppearanceDialog
          project={{
            id: iconBoard.id,
            name: iconBoard.title,
            icon: iconBoard.icon ?? defaultProjectIcon(iconBoard.id),
            myRole: iconBoard.myRole,
          }}
          board={{ save: (icon) => setBoardIcon(projectId, iconBoard.id, icon) }}
          onClose={() => setIconBoard(null)}
        />
      )}
      {importingScript && editable && !preview && (
        <ScreenplayImportDialog
          // Storyboard off: this storyboard still takes the script, a new one is not offered.
          targets={[
            'append',
            ...(scriptStoryboard.groups.some((g) => g.scene) ? (['revise'] as const) : []),
            ...(isOn('storyboard') ? (['new'] as const) : []),
          ]}
          storyboard={scriptStoryboard}
          onImport={importScript}
          onClose={() => setImportingScript(false)}
        />
      )}
      {scriptToast && (
        <Toast
          text={scriptToast}
          ok
          onUndo={() => conn.store.undo.undo()}
          history={conn.store.undo}
          onClose={closeScriptToast}
        />
      )}
      {exporting && (
        <ExportDialog
          source={exporting.source}
          initialWhat={exporting.what}
          imageEntry={exporting.imageEntry}
          pdfEntry={exporting.pdfEntry}
          store={preview?.store ?? conn.store}
          projectId={projectId}
          boardId={boardId}
          projectName={projectName}
          timeZone={shootingZone(projectTimeZone)}
          boardTitle={crumbs.at(-1)?.title ?? detail?.title ?? ''}
          boards={boards}
          selection={exporting.selection}
          visible={exporting.visible}
          role={detail?.myRole ?? projectRole}
          across={kind === 'production' ? (scheduleSources ?? undefined) : undefined}
          onClose={() => setExporting(null)}
        />
      )}
      <RestoredToast
        provider={conn.provider}
        boardId={boardId}
        store={conn.store}
        canList={editable}
      />
    </div>
  );
}

/** The canvas with the other people on the board. */
/**
 * The export dialog follows the open view; other views export the board's cards. The
 * Production board exports its call sheets (decision 0123).
 */
function exportSourceOf(view: string, kind?: Board['kind']): ExportSource {
  if (kind === 'production') return 'production';
  return view === 'storyboard' || view === 'shotlist' || view === 'schedule' ? view : 'canvas';
}

function BoardCanvas(props: Omit<Parameters<typeof Canvas>[0], 'peers'>) {
  const peers = usePeers(props.conn.provider);
  return <Canvas {...props} peers={peers} />;
}

const MAX_AVATARS = 5;

/**
 * The connection and the people on the board: how many are online and when our last change
 * was saved, who is writing in which card, and an avatar per person ringed in their colour.
 */
export function BoardPresence({ conn, selfId }: { conn: BoardConnection; selfId: string | null }) {
  const { t } = useTranslation();
  const { people, online, writing } = boardPeople(usePeers(conn.provider), selfId);
  const shown = people.slice(0, MAX_AVATARS);
  const name = (p: Peer) =>
    p.readOnly ? t('board.peers.viewing', { name: p.user.name }) : p.user.name;
  return (
    <>
      {people.length > 0 && (
        <ul className="peers" aria-label={t('board.peers.label', { count: people.length })}>
          {shown.map((p) => (
            <li
              key={p.user.id}
              className="peers__one"
              style={{ ['--peer' as string]: p.color }}
              title={name(p)}
            >
              <Avatar name={p.user.name} image={p.user.image} size={24} />
            </li>
          ))}
          {people.length > shown.length && (
            <li className="peers__more">+{people.length - shown.length}</li>
          )}
        </ul>
      )}
      <SyncStatus
        status={conn.status}
        readOnly={conn.readOnly}
        saves={conn.saves}
        online={online}
      />
      {writing.length > 0 && <EditingPeople people={writing} store={conn.store} />}
    </>
  );
}

/** Who is writing in which card; the card names come from the live board, so this mounts late. */
function EditingPeople({ people, store }: { people: Peer[]; store: BoardConnection['store'] }) {
  const { label } = useCardLabel(store);
  return <EditingLine editors={editingPeople(people, label)} />;
}

/** How many boards sit somewhere under this one. */
function countBelow(boardId: string, boards: Board[] | null): number {
  const children = new Map<string, string[]>();
  for (const b of boards ?? [])
    if (b.parentBoardId)
      children.set(b.parentBoardId, [...(children.get(b.parentBoardId) ?? []), b.id]);
  let n = 0;
  const stack = [...(children.get(boardId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    n++;
    stack.push(...(children.get(id) ?? []));
  }
  return n;
}

/** Path from the project root to this board; uses the board list when the detail is missing. */
export function breadcrumb(
  boardId: string,
  rootBoardId: string | undefined,
  projectName: string,
  detail: BoardDetail | null,
  boards: Board[] | null,
): Array<{ id: string; title: string }> {
  const byId = new Map((boards ?? []).map((b) => [b.id, b]));
  const boardTitle = (id: string, fallback: string) => byId.get(id)?.title ?? fallback;
  const rootTitle = (id: string, title: string) =>
    id === rootBoardId ? projectName : boardTitle(id, title);
  if (detail) {
    return [...detail.breadcrumb, { id: detail.id, title: detail.title }].map((c) => ({
      id: c.id,
      title: rootTitle(c.id, c.title),
    }));
  }
  const chain: Array<{ id: string; title: string }> = [];
  let current: string | null = boardId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const b = byId.get(current);
    if (!b) break;
    chain.unshift({ id: b.id, title: rootTitle(b.id, b.title) });
    current = b.parentBoardId;
  }
  if (rootBoardId && chain[0]?.id !== rootBoardId)
    chain.unshift({ id: rootBoardId, title: projectName });
  return chain;
}

/** The session ended while the board was open: check it, which sends people to sign-in. */
function SignedOut() {
  const { t } = useTranslation();
  const { refresh } = useSession();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="board-state">
      <EmptyState icon="lock" title={t('board.signedOut.title')}>
        {t('board.signedOut.body')}
      </EmptyState>
    </div>
  );
}
