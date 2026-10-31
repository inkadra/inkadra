import type { Element } from '@inkadra/doc-schema';
import type {
  Board,
  GuestBoardSnapshot,
  GuestSession,
  GuestSetElementReview,
  SetPick,
  ShareLinkPreview,
} from '@inkadra/shared';
import { Logo } from '@inkadra/ui';
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
import { useSearchParams } from 'react-router';
import type * as Y from 'yjs';
import { primeAsset } from '../board/assets.ts';
import { Canvas } from '../board/Canvas.tsx';
import { type BoardConnection, createSaveStore } from '../board/connection.ts';
import { CardExtrasContext, GuestModeContext } from '../board/context.ts';
import { BoardStore } from '../board/store.ts';
import { NoSessionProvider } from '../lib/session.tsx';
import { type GuestActions, GuestActionsContext } from './actions.ts';
import { GuestRequestError, guestApi } from './api.ts';
import { GuestCardExtras } from './GuestCardExtras.tsx';
import { GuestPanel } from './GuestPanel.tsx';
import { GuestViewer } from './GuestViewer.tsx';
import { toAsset } from './guest-assets.ts';
import { createGuestDoc, syncGuestDoc } from './guest-doc.ts';
import {
  failureOf,
  isPicture,
  needsSession,
  type Rights,
  retryAfterMs,
  rightsOf,
  type Stop,
} from './model.ts';
import { NameDialog } from './NameDialog.tsx';
import { createPoller, type Poller, type PollOutcome } from './poller.ts';
import '../board/board.css';
import '../board/film/film.css';

/** How often an open guest page asks whether the board changed (a 304 when it did not). */
const POLL_MS = 5000;
/** Longest wait between two requests after failures. */
const POLL_MAX_MS = 60_000;

const asBoards = (session: GuestSession): Board[] =>
  session.boards.map((b) => ({
    id: b.id,
    projectId: '',
    parentBoardId: b.parentBoardId,
    kind: b.kind,
    title: b.title,
    position: '',
    coverAssetId: null,
    docSchemaVersion: 0,
    createdAt: '',
    updatedAt: '',
    myRole: 'viewer',
  }));

function useStore(boardId: string) {
  const [store, setStore] = useState<BoardStore | null>(null);
  useEffect(() => {
    const doc: Y.Doc = createGuestDoc(boardId);
    const next = new BoardStore(doc);
    setStore(next);
    return () => {
      next.destroy();
      doc.destroy();
      setStore(null);
    };
  }, [boardId]);
  return store;
}

export function GuestBoardScreen({
  preview,
  session,
  onSession,
  onStop,
  onPasswordChanged,
}: {
  preview: ShareLinkPreview;
  session: GuestSession;
  onSession: (session: GuestSession) => void;
  onStop: (stop: Stop) => void;
  onPasswordChanged: () => void;
}) {
  const { t } = useTranslation();
  const linkId = session.linkId;
  const [params, setParams] = useSearchParams();
  const asked = params.get('board');
  const boardId = session.boards.some((b) => b.id === asked) && asked ? asked : session.boardId;
  const rights = useMemo(() => rightsOf(session), [session]);
  const store = useStore(boardId);
  const [snapshot, setSnapshot] = useState<GuestBoardSnapshot | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ next: () => unknown } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const version = useRef<string | undefined>(undefined);
  const snapshotRef = useRef<GuestBoardSnapshot | null>(null);
  const sessionAsked = useRef(Date.now());
  const poller = useRef<Poller | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The page's callbacks change with each of its renders; polling must not restart for that.
  const handlers = useRef({ onSession, onStop, onPasswordChanged });
  handlers.current = { onSession, onStop, onPasswordChanged };

  const fail = useCallback(
    (err: unknown): string | null => {
      const f = failureOf(err);
      if (f.kind === 'stop') {
        if (f.stop === 'rate_limited') return t('guest.errors.rateLimited');
        if (f.stop === 'not_found') return t('guest.errors.notFound');
        handlers.current.onStop(f.stop);
        return null;
      }
      if (f.kind === 'password') {
        handlers.current.onPasswordChanged();
        return null;
      }
      if (f.kind === 'name') return t('guest.name.required');
      if (f.kind === 'transient') return t('guest.errors.offline');
      return t('guest.errors.generic');
    },
    [t],
  );

  const load = useCallback(
    async (signal: AbortSignal): Promise<PollOutcome> => {
      try {
        const next = await guestApi.snapshot(linkId, boardId, version.current, signal);
        // A board left meanwhile: its answer must not land on the new one.
        if (signal.aborted) return { kind: 'done' };
        setOffline(false);
        const prev = snapshotRef.current;
        if (next) {
          version.current = next.version;
          snapshotRef.current = next;
          setSnapshot(next);
        }
        // Options, role and boards of the link may have changed with it.
        const now = Date.now();
        if (needsSession(prev, next, sessionRef.current, sessionAsked.current, now)) {
          const s = await guestApi.session(linkId, signal);
          if (signal.aborted) return { kind: 'done' };
          sessionAsked.current = Date.now();
          if (JSON.stringify(s) !== JSON.stringify(sessionRef.current))
            handlers.current.onSession(s);
        }
        return { kind: 'ok' };
      } catch (err) {
        if (signal.aborted) return { kind: 'done' };
        const f = failureOf(err);
        if (f.kind === 'transient') {
          setOffline(true);
          return { kind: 'retry' };
        }
        if (f.kind === 'stop' && f.stop === 'rate_limited') {
          const after = err instanceof GuestRequestError ? retryAfterMs(err.retryAfter) : undefined;
          return after === undefined ? { kind: 'retry' } : { kind: 'retry', after };
        }
        // A board that left the link: back to the board of the link.
        if (f.kind === 'stop' && f.stop === 'not_found' && boardId !== session.boardId) {
          setParams({}, { replace: true });
          return { kind: 'done' };
        }
        if (f.kind === 'stop' && f.stop === 'not_found') {
          handlers.current.onStop('unavailable');
          return { kind: 'done' };
        }
        if (f.kind === 'stop' || f.kind === 'password') {
          fail(err);
          return { kind: 'done' };
        }
        return { kind: 'retry' };
      }
    },
    [linkId, boardId, session.boardId, fail, setParams],
  );

  // A new board starts from nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the board changes
  useEffect(() => {
    version.current = undefined;
    snapshotRef.current = null;
    setSnapshot(null);
    setLoaded(null);
    setSelected(null);
    setViewing(null);
  }, [boardId]);

  useEffect(() => {
    const p = createPoller({
      run: load,
      interval: POLL_MS,
      max: POLL_MAX_MS,
      hidden: () => document.hidden,
    });
    poller.current = p;
    p.start();
    const onVisible = () => p.poke();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      p.stop();
      if (poller.current === p) poller.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [load]);

  // The snapshot drawn by the board's own canvas, through a doc that lives only here.
  useEffect(() => {
    if (!store || !snapshot || snapshot.board.id !== boardId) return;
    for (const a of snapshot.assets) primeAsset(toAsset(a));
    syncGuestDoc(store.doc, snapshot.elements, snapshot.board.aspect);
    setLoaded(boardId);
  }, [store, snapshot, boardId]);

  const assets = useMemo(() => new Map((snapshot?.assets ?? []).map((a) => [a.id, a])), [snapshot]);
  const picks = useMemo(
    () => new Map((snapshot?.picks ?? []).map((p) => [p.elementId, p])),
    [snapshot],
  );
  const reviews = useMemo(
    () => new Map((snapshot?.reviews ?? []).map((r) => [r.elementId, r])),
    [snapshot],
  );
  const counts = useMemo(
    () => new Map((snapshot?.commentCounts ?? []).map((c) => [c.elementId, c])),
    [snapshot],
  );

  const withName = useCallback((action: () => unknown) => {
    if (sessionRef.current.guest.name) void action();
    else setNaming({ next: action });
  }, []);

  const refresh = useCallback(() => poller.current?.poke({ force: true }), []);

  const pick = useCallback(
    async (elementId: string, body: SetPick) => {
      try {
        const saved = await guestApi.pick(linkId, boardId, elementId, body);
        setSnapshot((s) =>
          s
            ? {
                ...s,
                picks: [
                  ...s.picks.filter((p) => p.elementId !== elementId),
                  ...(saved.pick || saved.stars ? [saved] : []),
                ],
              }
            : s,
        );
        refresh();
      } catch (err) {
        if (failureOf(err).kind === 'name') setNaming({ next: () => pick(elementId, body) });
        else {
          const message = fail(err);
          if (message) throw new Error(message);
        }
      }
    },
    [linkId, boardId, refresh, fail],
  );

  const review = useCallback(
    async (elementId: string, body: GuestSetElementReview) => {
      try {
        const saved = await guestApi.review(linkId, boardId, elementId, body);
        setSnapshot((s) =>
          s
            ? {
                ...s,
                reviews: [
                  ...s.reviews.filter((r) => r.elementId !== elementId),
                  ...(saved.status === 'none' ? [] : [saved]),
                ],
              }
            : s,
        );
        refresh();
        return true;
      } catch (err) {
        if (failureOf(err).kind === 'name') {
          setNaming({ next: () => review(elementId, body) });
          return false;
        }
        const message = fail(err);
        if (message) throw new Error(message);
        return false;
      }
    },
    [linkId, boardId, refresh, fail],
  );

  const elements = useMemo(
    () => new Map((snapshot?.elements ?? []).map((e) => [e.id, e])),
    [snapshot],
  );

  const actions: GuestActions = useMemo(
    () => ({
      linkId,
      boardId,
      rights,
      guestName: session.guest.name,
      version: snapshot?.version ?? '',
      assets,
      picks,
      reviews,
      counts,
      pick,
      review,
      withName,
      refresh,
      fail,
      select: setSelected,
      view: setViewing,
      notify: setNotice,
      notice,
    }),
    [
      linkId,
      boardId,
      rights,
      session.guest.name,
      snapshot?.version,
      assets,
      picks,
      reviews,
      counts,
      pick,
      review,
      withName,
      refresh,
      fail,
      notice,
    ],
  );

  const conn = useMemo<BoardConnection | null>(
    () =>
      store
        ? {
            store,
            // The guest page has no collaboration connection: the canvas runs as a preview,
            // which never touches the provider.
            provider: null as unknown as BoardConnection['provider'],
            status: 'synced',
            readOnly: true,
            accessChangedAt: null,
            saves: createSaveStore(),
          }
        : null,
    [store],
  );

  const boards = useMemo(() => asBoards(session), [session]);
  const openBoard = useCallback(
    (id: string) => {
      if (!session.boards.some((b) => b.id === id)) return;
      setParams(id === session.boardId ? {} : { board: id });
    },
    [session, setParams],
  );
  const onSelectionChange = useCallback((ids: ReadonlySet<string>) => {
    setSelected(ids.size === 1 ? ([...ids][0] ?? null) : null);
  }, []);
  const onOpen = useCallback((el: Element) => {
    if (el.type !== 'image' && el.type !== 'file' && el.type !== 'frame') return false;
    setSelected(el.id);
    if (el.type !== 'frame' || isPicture(el)) setViewing(el.id);
    return true;
  }, []);
  const extras = useCallback((el: Element) => <GuestCardExtras element={el} />, []);

  const crumbs = snapshot
    ? [...snapshot.breadcrumb, { id: snapshot.board.id, title: snapshot.board.title }]
    : [];
  const sharedBy = session.sharedBy === undefined ? preview.sharedBy : session.sharedBy;
  const viewed = viewing ? elements.get(viewing) : undefined;

  return (
    <GuestActionsContext.Provider value={actions}>
      <div className="guest">
        <header className="guest__header">
          <Logo size={24} label={preview.instanceName} />
          <nav aria-label={t('guest.breadcrumb')} className="guest__crumbs">
            {crumbs.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && (
                  <span className="crumb__sep" aria-hidden="true">
                    /
                  </span>
                )}
                {i === crumbs.length - 1 ? (
                  <h1 className="guest__title" aria-current="page">
                    {c.title}
                  </h1>
                ) : (
                  <a
                    className="crumb"
                    href={c.id === session.boardId ? '?' : `?board=${c.id}`}
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
          <span className="guest__spacer" />
          {offline && (
            <span className="guest__offline" role="status">
              {t('guest.offline')}
            </span>
          )}
          {sharedBy && (
            <span className="guest__shared ink-muted">
              {t('guest.sharedBy', { name: sharedBy })}
            </span>
          )}
          <span className="guest__badge">{t(`guest.roles.${rightsKey(rights)}`)}</span>
        </header>
        <div className="guest__body">
          <div className="guest__canvas">
            {conn && loaded === boardId ? (
              <NoSessionProvider>
                <GuestModeContext.Provider value={true}>
                  <CardExtrasContext.Provider value={extras}>
                    <Canvas
                      key={boardId}
                      conn={conn}
                      preview
                      projectId=""
                      breadcrumb={crumbs.map((c) => c.title)}
                      boardId={boardId}
                      userId=""
                      boards={boards}
                      canEdit={false}
                      peers={[]}
                      onOpenBoard={openBoard}
                      onSelectionChange={onSelectionChange}
                      onOpen={onOpen}
                    />
                  </CardExtrasContext.Provider>
                </GuestModeContext.Provider>
              </NoSessionProvider>
            ) : (
              <p className="guest__loading ink-muted" role="status">
                {t('guest.loading')}
              </p>
            )}
            {loaded === boardId && snapshot && snapshot.elements.length === 0 && (
              <p className="guest__empty ink-muted">{t('guest.emptyBoard')}</p>
            )}
          </div>
          <GuestPanel
            session={session}
            snapshot={snapshot}
            selected={selected ? (elements.get(selected) ?? null) : null}
            onOpenBoard={openBoard}
            onAskName={() => setNaming({ next: () => {} })}
          />
        </div>
        {viewed && <GuestViewer element={viewed} onClose={() => setViewing(null)} />}
        <NameDialog
          open={naming !== null}
          linkId={linkId}
          initial={session.guest.name ?? ''}
          onSaved={(s) => {
            onSession(s);
            sessionRef.current = s;
            const next = naming?.next;
            setNaming(null);
            void next?.();
          }}
          onCancel={() => setNaming(null)}
          onError={fail}
        />
      </div>
    </GuestActionsContext.Provider>
  );
}

function rightsKey(rights: Rights): 'view' | 'comment' | 'approve' {
  return rights.review ? 'approve' : rights.comments ? 'comment' : 'view';
}
