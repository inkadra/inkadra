import type { Board, BoardDetail, ProjectRole } from '@inkadra/shared';
import { EmptyState } from '@inkadra/ui';
import { Fragment, type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useHeaderContent } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useProjects } from '../routes/AppLayout.tsx';
import { fetchBoard, useProjectBoards } from './boards.ts';
import { Canvas } from './Canvas.tsx';
import { type ConnectionStatus, useBoardConnection } from './connection.ts';
import './board.css';

const canEdit = (role: ProjectRole | undefined) => role === 'owner' || role === 'editor';

export const boardPath = (projectId: string, boardId: string, rootBoardId?: string) =>
  boardId === rootBoardId ? `/p/${projectId}` : `/p/${projectId}/b/${boardId}`;

/** /p/:projectId shows the root board, /p/:projectId/b/:boardId a nested one. */
export function BoardPage() {
  const { projectId, boardId: param } = useParams();
  const { projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  const boardId = param ?? project?.rootBoardId;
  if (!projectId || !project || !boardId) return null;
  return (
    <BoardScreen
      key={boardId}
      projectId={projectId}
      projectName={project.name}
      rootBoardId={project.rootBoardId}
      projectRole={project.myRole}
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
  rootBoardId: string;
  projectRole: ProjectRole;
  boardId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  const { items: boards } = useProjectBoards(projectId);
  const conn = useBoardConnection(boardId);
  const [detail, setDetail] = useState<BoardDetail | null>(null);

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
        <span className="ink-header__spacer" />
        {conn && <SyncStatus status={conn.status} readOnly={conn.readOnly} />}
      </>
    ),
    [crumbs, t, projectId, rootBoardId, openBoard, conn],
  );
  useHeaderContent(header);

  if (!conn || !user) return null;
  if (conn.status === 'denied') {
    return (
      <div className="board-state">
        <EmptyState icon="lock" title={t('board.denied.title')}>
          {t('board.denied.body')}
        </EmptyState>
      </div>
    );
  }
  return (
    <Canvas
      conn={conn}
      projectId={projectId}
      boardId={boardId}
      userId={user.id}
      boards={boards}
      canEdit={canEdit(detail?.myRole ?? projectRole)}
      onOpenBoard={openBoard}
    />
  );
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
  rootBoardId: string,
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
  if (chain[0]?.id !== rootBoardId) chain.unshift({ id: rootBoardId, title: projectName });
  return chain;
}
