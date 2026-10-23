import type { Board, BoardDetail, ProjectRole } from '@inkadra/shared';
import { Avatar, Button, EmptyState, Icon, type IconName } from '@inkadra/ui';
import { Fragment, type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useHeaderContent } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useProjects } from '../routes/AppLayout.tsx';
import { boardPath, fetchBoard, useProjectBoards } from './boards.ts';
import { Canvas } from './Canvas.tsx';
import { type ConnectionStatus, useBoardConnection } from './connection.ts';
import { ShotList } from './film/ShotList.tsx';
import { StoryboardView } from './film/StoryboardView.tsx';
import './film/film.css';
import { type Peer, uniquePeople, usePeers } from './presence.ts';
import { ShareDialog } from './ShareDialog.tsx';
import './board.css';

const canEdit = (role: ProjectRole | undefined) => role === 'owner' || role === 'editor';

export type BoardView = 'storyboard' | 'shotlist' | 'canvas';
const VIEWS: Array<{ view: BoardView; icon: IconName }> = [
  { view: 'storyboard', icon: 'storyboard' },
  { view: 'shotlist', icon: 'shotlist' },
  { view: 'canvas', icon: 'board' },
];

/** Storyboards open on the storyboard; `?view=` picks another view of the same board. */
export function useBoardView(kind: Board['kind'] | undefined): [BoardView, (v: BoardView) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const view: BoardView =
    kind !== 'storyboard'
      ? 'canvas'
      : asked === 'shotlist' || asked === 'canvas'
        ? asked
        : 'storyboard';
  const setView = useCallback(
    (v: BoardView) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (v === 'storyboard') next.delete('view');
          else next.set('view', v);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [view, setView];
}

/** /p/:projectId shows the root board, /p/:projectId/b/:boardId a nested one. */
export function BoardPage() {
  const { projectId, boardId: param } = useParams();
  const { projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  const boardId = param ?? project?.rootBoardId;
  if (!projectId || !projects || !boardId) return null;
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
  const { user } = useSession();
  const { items: boards } = useProjectBoards(projectId);
  const conn = useBoardConnection(boardId);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const kind = detail?.kind ?? boards?.find((b) => b.id === boardId)?.kind;
  const [view, setView] = useBoardView(kind);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchBoard(boardId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [boardId]);

  const openBoard = useCallback(
    (id: string) => navigate(boardPath(projectId, id, rootBoardId)),
    [navigate, projectId, rootBoardId],
  );

  const crumbs = useMemo(
    () => breadcrumb(boardId, rootBoardId, projectName, detail, boards),
    [boardId, rootBoardId, projectName, detail, boards],
  );

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
                <span className="crumb crumb--current" aria-current="page">
                  {c.title}
                </span>
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
        {kind === 'storyboard' && (
          <div className="view-tabs" role="tablist" aria-label={t('film.views.label')}>
            {VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                role="tab"
                aria-selected={view === v.view}
                className="view-tabs__tab"
                onClick={() => setView(v.view)}
              >
                <Icon name={v.icon} size={14} />
                {t(`film.views.${v.view}`)}
              </button>
            ))}
          </div>
        )}
        <span className="ink-header__spacer" />
        {conn && <SyncStatus status={conn.status} readOnly={conn.readOnly} />}
        {conn && <Peers provider={conn.provider} />}
        {detail && (
          <Button
            variant={
              detail.myRole === 'owner' || detail.myRole === 'editor' ? 'primary' : 'secondary'
            }
            icon="people"
            onClick={() => setSharing(true)}
          >
            {t('share.open')}
          </Button>
        )}
      </>
    ),
    [crumbs, t, projectId, rootBoardId, openBoard, conn, kind, view, setView, detail],
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
    return (
      <div className="board-state">
        <EmptyState icon="lock" title={t('board.denied.title')}>
          {t('board.denied.body')}
        </EmptyState>
      </div>
    );
  }
  const editable = !conn.readOnly && canEdit(detail?.myRole ?? projectRole);
  if (view === 'storyboard') {
    return (
      <StoryboardView
        store={conn.store}
        projectId={projectId}
        userId={user.id}
        readOnly={!editable}
      />
    );
  }
  if (view === 'shotlist') {
    return (
      <ShotList store={conn.store} boardTitle={crumbs.at(-1)?.title ?? ''} readOnly={!editable} />
    );
  }
  return (
    <>
      <BoardCanvas
        conn={conn}
        projectId={projectId}
        boardId={boardId}
        userId={user.id}
        boards={boards}
        canEdit={canEdit(detail?.myRole ?? projectRole ?? undefined)}
        onOpenBoard={openBoard}
      />
      {shareDialog}
    </>
  );
}

/** The canvas with the other people on the board. */
function BoardCanvas(props: Omit<Parameters<typeof Canvas>[0], 'peers'>) {
  const peers = usePeers(props.conn.provider);
  return <Canvas {...props} peers={peers} />;
}

const MAX_AVATARS = 5;

/** Who else has the board open, one avatar per person, ringed in their cursor colour. */
function Peers({ provider }: { provider: Parameters<typeof usePeers>[0] }) {
  const { t } = useTranslation();
  const people = uniquePeople(usePeers(provider));
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_AVATARS);
  const label = (p: Peer) =>
    p.readOnly ? t('board.peers.viewing', { name: p.user.name }) : p.user.name;
  return (
    <ul className="peers" aria-label={t('board.peers.label', { count: people.length })}>
      {shown.map((p) => (
        <li
          key={p.user.id}
          className="peers__one"
          style={{ ['--peer' as string]: p.color }}
          title={label(p)}
        >
          <Avatar name={p.user.name} size={24} />
        </li>
      ))}
      {people.length > shown.length && (
        <li className="peers__more">+{people.length - shown.length}</li>
      )}
    </ul>
  );
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

function SyncStatus({ status, readOnly }: { status: ConnectionStatus; readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`sync sync--${status}`} role="status">
      <span className="sync__dot" aria-hidden="true" />
      {readOnly ? t('board.status.readOnly') : t(`board.status.${status}`)}
    </span>
  );
}

/** Path from the project root to this board; uses the board list when the detail is missing. */
export function breadcrumb(
  boardId: string,
  rootBoardId: string | undefined,
  projectName: string,
  detail: BoardDetail | null,
  boards: Board[] | null,
): Array<{ id: string; title: string }> {
  const rootTitle = (id: string, title: string) => (id === rootBoardId ? projectName : title);
  if (detail) {
    return [...detail.breadcrumb, { id: detail.id, title: detail.title }].map((c) => ({
      id: c.id,
      title: rootTitle(c.id, c.title),
    }));
  }
  const byId = new Map((boards ?? []).map((b) => [b.id, b]));
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
