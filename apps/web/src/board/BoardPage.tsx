import type { Rect } from '@inkadra/canvas-core';
import type { Board, BoardDetail, ProjectRole } from '@inkadra/shared';
import { Avatar, Button, EmptyState, Icon, IconButton } from '@inkadra/ui';
import {
  Fragment,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useRegisterActions } from '../commands/actions.ts';
import { useHeaderContent } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useProjects } from '../routes/AppLayout.tsx';
import { NotFound } from '../routes/NotFound.tsx';
import { renameProject } from '../routes/projects.ts';
import { boardPath, fetchBoard, renameBoard, useProjectBoards } from './boards.ts';
import { Canvas } from './Canvas.tsx';
import { CommentsButton, useCardLabel } from './CommentsPanel.tsx';
import { ContextMenu, Toast } from './chrome.tsx';
import { type BoardConnection, useBoardConnection } from './connection.ts';
import { DeniedState } from './DeniedState.tsx';
import { ExportDialog, type ExportSource } from './export/ExportDialog.tsx';
import type { ExportWhat } from './export/engine.ts';
import { ClientReviewView } from './film/ClientReviewView.tsx';
import { MoodboardView } from './film/MoodboardView.tsx';
import { ScheduleView } from './film/ScheduleView.tsx';
import { ShotList } from './film/ShotList.tsx';
import { StoryboardView } from './film/StoryboardView.tsx';
import { createScreenplayStoryboard } from './film/screenplay/new-storyboard.ts';
import { applyImport, type ImportPlan } from './film/screenplay/plan.ts';
import {
  type ImportTarget,
  ScreenplayImportDialog,
} from './film/screenplay/ScreenplayImportDialog.tsx';
import { boardPeople, EditingLine, editingPeople, SyncStatus } from './header-status.tsx';
import { RestoredToast } from './RestoredToast.tsx';
import { LOCAL } from './store.ts';
import { type VersionPreview, VersionsDialog } from './VersionsDialog.tsx';
import {
  type BoardView,
  headerViews,
  isBoardView,
  storyboardOf,
  viewDestination,
  viewHref,
  viewIcon,
} from './views.ts';
import './film/film.css';
import { type Peer, usePeers } from './presence.ts';
import { projectLanding } from './project-landing.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { isStartTemplate, seedStoryboard, seedTemplate, templateLabels } from './templates.ts';
import { useBoardReviews } from './use-board-reviews.ts';
import './board.css';

const canEdit = (role: ProjectRole | null | undefined) => role === 'owner' || role === 'editor';

export { type BoardView, VIEWS } from './views.ts';

/** Storyboards open on the storyboard; `?view=` picks another view of the same board. */
export function useBoardView(kind: Board['kind'] | undefined): [BoardView, (v: BoardView) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const view: BoardView = isBoardView(asked)
    ? asked
    : kind === 'storyboard'
      ? 'storyboard'
      : 'canvas';
  const setView = useCallback(
    (v: BoardView) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (kind === 'storyboard' ? v === 'storyboard' : v === 'canvas') {
            next.delete('view');
          } else {
            next.set('view', v);
          }
          return next;
        },
        { replace: true },
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
      rootBoardId={project?.rootBoardId}
      projectRole={project?.myRole ?? null}
      boardId={boardId}
    />
  );
}

function CurrentCrumb({
  title,
  ariaLabel,
  maxLength,
  canRename,
  onRename,
}: {
  title: string;
  ariaLabel?: string;
  maxLength: number;
  canRename: boolean;
  onRename: (title: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
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

function BoardScreen({
  projectId,
  projectName,
  rootBoardId,
  projectRole,
  boardId,
}: {
  projectId: string;
  projectName: string;
  rootBoardId: string | undefined;
  projectRole: ProjectRole | null;
  boardId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSession();
  const { items: boards } = useProjectBoards(projectId);
  const conn = useBoardConnection(boardId);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const kind = detail?.kind ?? boards?.find((b) => b.id === boardId)?.kind;
  const [view, setView] = useBoardView(kind);
  const [sharing, setSharing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const liveSelection = useRef<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState<{
    source: ExportSource;
    what?: ExportWhat;
    selection: ReadonlySet<string>;
    visible: Rect | null;
  } | null>(null);
  const visibleRef = useRef<(() => Rect | null) | null>(null);
  // Selection and visible area are read when the dialog opens, not followed afterwards.
  const openExport = useCallback((source: ExportSource, what?: ExportWhat) => {
    setExporting({
      source,
      ...(what ? { what } : {}),
      selection: liveSelection.current,
      visible: visibleRef.current?.() ?? null,
    });
  }, []);
  const exportSelection = useCallback(() => openExport('canvas', 'selection'), [openExport]);
  const exportStoryboard = useCallback(() => openExport('storyboard'), [openExport]);
  const exportShotList = useCallback(() => openExport('shotlist'), [openExport]);
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
  // Film views open on the project's storyboard, as they do from the sidebar and the rail.
  const storyboardId = useMemo(() => storyboardOf(boards), [boards]);
  const chooseView = useCallback(
    (next: BoardView) => {
      const destination = viewDestination(next, { boardId, kind, rootBoardId }, storyboardId);
      if (destination.boardId) {
        navigate(viewHref(projectId, destination, { boardId, rootBoardId, kind }));
        return;
      }
      setView(next);
    },
    [boardId, kind, rootBoardId, storyboardId, navigate, projectId, setView],
  );

  const tabs = useMemo(() => headerViews(kind, view), [kind, view]);

  // The palette offers a view only when the header shows its tab.
  useRegisterActions(
    conn?.status !== 'synced'
      ? []
      : [
          ...tabs.map((target) => ({
            id: `view-${target}`,
            label: t(`film.views.${target}`),
            run: () => chooseView(target),
          })),
          ...(editable
            ? [{ id: 'versions', label: t('versions.title'), run: () => setVersionsOpen(true) }]
            : []),
          ...(detail ? [{ id: 'share', label: t('share.open'), run: () => setSharing(true) }] : []),
        ],
  );
  useEffect(() => {
    const template: unknown = location.state?.template;
    const storyboard = template === 'storyboard' && kind === 'storyboard';
    const canvas = isStartTemplate(template) && kind === 'board';
    if ((!storyboard && !canvas) || conn?.status !== 'synced' || !editable || !user) return;
    conn.store.undo.stopCapturing();
    if (isStartTemplate(template)) {
      seedTemplate(conn.store.doc, template, templateLabels(t), user.id);
    } else {
      seedStoryboard(conn.store.doc, t('templates.storyboard.scene'), user.id);
    }
    conn.store.undo.stopCapturing();
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location, kind, conn, editable, user, t, navigate]);
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

  const openBoard = useCallback(
    (id: string, template?: 'storyboard') =>
      navigate(boardPath(projectId, id, rootBoardId), { state: template ? { template } : null }),
    [navigate, projectId, rootBoardId],
  );
  useBoardReviews(boardId, conn, detail?.myRole ?? projectRole, {
    preview: !!preview,
    canvas: view === 'canvas',
  });

  const crumbs = useMemo(
    () => breadcrumb(boardId, rootBoardId, projectName, detail, boards),
    [boardId, rootBoardId, projectName, detail, boards],
  );
  const crumbTitles = useMemo(() => crumbs.map((c) => c.title), [crumbs]);

  /** Appends to this storyboard as one undo step, or makes a new one beside it and opens it. */
  const importScript = useCallback(
    async (plan: ImportPlan, target: ImportTarget) => {
      if (!conn || !user) return;
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

  const header = useMemo(
    () => (
      <>
        <nav aria-label={t('nav.breadcrumb')} className="ink-header__crumbs">
          {crumbs.map((c, i) => (
            <Fragment key={c.id}>
              {i > 0 && (
                <span className="crumb__sep" aria-hidden="true">
                  /
                </span>
              )}
              {i === crumbs.length - 1 ? (
                <CurrentCrumb
                  title={c.title}
                  ariaLabel={c.id === rootBoardId ? t('project.name') : t('board.board.title')}
                  // The limits of UpdateProject.name and UpdateBoard.title.
                  maxLength={c.id === rootBoardId ? 120 : 200}
                  canRename={editable && (boardId !== rootBoardId || canEdit(projectRole))}
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
        {tabs.length > 0 && (
          <div
            className="view-tabs"
            role="tablist"
            aria-label={t('film.views.label')}
            onKeyDown={(e) => {
              // Arrow keys walk the tabs; Enter and Space pick one, as on any button.
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
              const at = all.indexOf(document.activeElement as HTMLButtonElement);
              e.preventDefault();
              all[(at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
            }}
          >
            {tabs.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                tabIndex={view === v ? 0 : -1}
                className="view-tabs__tab"
                // On narrow desktops only the open tab keeps its name: the rest say it on hover.
                aria-label={t(`film.views.${v}`)}
                title={t(`film.views.${v}`)}
                onClick={() => chooseView(v)}
              >
                <Icon name={viewIcon(v)} contentKind={v} size={14} />
                <span className="view-tabs__label">{t(`film.views.${v}`)}</span>
              </button>
            ))}
          </div>
        )}
        <span className="ink-header__spacer" />
        {conn && <BoardPresence conn={conn} selfId={selfId} />}
        {editable && (
          <>
            <IconButton
              icon="clock"
              label={t('versions.title')}
              onClick={() => setVersionsOpen(true)}
            />
            <div className="board-header-menu" ref={headerMenuAnchor}>
              <IconButton
                id="board-header-menu"
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
                    { label: t('versions.title'), action: () => setVersionsOpen(true) },
                    { divider: true },
                    {
                      label: t('board.export.action'),
                      action: () => openExport(exportSourceOf(view)),
                    },
                    // Presenting lives in the Storyboard view.
                    {
                      label: t('board.present.action'),
                      disabled: true,
                      hint: t('board.present.soon'),
                    },
                  ]}
                />
              )}
            </div>
          </>
        )}
        {detail && (
          <Button
            variant={
              detail.myRole === 'owner' || detail.myRole === 'editor' ? 'primary' : 'secondary'
            }
            icon="people"
            className="board-share"
            aria-label={t('share.open')}
            onClick={() => setSharing(true)}
          >
            <span className="board-share__label">{t('share.open')}</span>
          </Button>
        )}
        <CommentsButton />
      </>
    ),
    [
      crumbs,
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
      closeHeaderMenu,
      openExport,
      handleRenameCurrentBoard,
      boardId,
      projectRole,
      selfId,
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
    return <DeniedState />;
  }
  const versions = editable && (
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
        onImportScript={openScriptImport}
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
    ) : view === 'schedule' ? (
      <ScheduleView
        key={preview?.version.id ?? 'live'}
        store={preview?.store ?? conn.store}
        boardTitle={crumbs.at(-1)?.title ?? ''}
        projectName={projectName}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        readOnly={!!preview || !editable}
      />
    ) : view === 'review' ? (
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
        onClose={() => setView(kind === 'storyboard' ? 'storyboard' : 'canvas')}
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
    >
      {versions}
      {content}
      {shareDialog}
      {importingScript && editable && !preview && (
        <ScreenplayImportDialog
          targets={['append', 'new']}
          onImport={importScript}
          onClose={() => setImportingScript(false)}
        />
      )}
      {scriptToast && (
        <Toast
          text={scriptToast}
          onUndo={() => conn.store.undo.undo()}
          onClose={closeScriptToast}
        />
      )}
      {exporting && (
        <ExportDialog
          source={exporting.source}
          initialWhat={exporting.what}
          store={preview?.store ?? conn.store}
          projectId={projectId}
          boardId={boardId}
          projectName={projectName}
          boardTitle={crumbs.at(-1)?.title ?? detail?.title ?? ''}
          boards={boards}
          selection={exporting.selection}
          visible={exporting.visible}
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
/** The export dialog follows the open view; other views export the board's cards. */
function exportSourceOf(view: string): ExportSource {
  return view === 'storyboard' || view === 'shotlist' ? view : 'canvas';
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
function BoardPresence({ conn, selfId }: { conn: BoardConnection; selfId: string | null }) {
  const { t } = useTranslation();
  const { people, online, writing } = boardPeople(usePeers(conn.provider), selfId);
  const shown = people.slice(0, MAX_AVATARS);
  const name = (p: Peer) =>
    p.readOnly ? t('board.peers.viewing', { name: p.user.name }) : p.user.name;
  return (
    <>
      <SyncStatus
        status={conn.status}
        readOnly={conn.readOnly}
        saves={conn.saves}
        online={online}
      />
      {writing.length > 0 && <EditingPeople people={writing} store={conn.store} />}
      {people.length > 0 && (
        <ul className="peers" aria-label={t('board.peers.label', { count: people.length })}>
          {shown.map((p) => (
            <li
              key={p.user.id}
              className="peers__one"
              style={{ ['--peer' as string]: p.color }}
              title={name(p)}
            >
              <Avatar name={p.user.name} size={24} />
            </li>
          ))}
          {people.length > shown.length && (
            <li className="peers__more">+{people.length - shown.length}</li>
          )}
        </ul>
      )}
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
