import type { BoardCount } from '@inkadra/shared';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { boardPath, loadBoards } from '../board/boards.ts';
import { boardViews, defaultView, viewHref } from '../board/views.ts';
import { api } from '../lib/api.ts';
import { preferencesLoaded, usePreferences } from '../lib/preferences.ts';
import { SessionContext } from '../lib/session-context.ts';
import { addBoard } from '../routes/add-storyboard.ts';
import { useProjects } from '../routes/projects-context.ts';
import { type ToastMessage, TourPill, TourToast } from './Pill.tsx';
import { enabledViews, kindFor, screenOf, startBoard, startViews } from './start.ts';
import { autoOffers, markSeen, requestTour, useRequestedTour } from './state.ts';
import { findAnchor, TourPlayer } from './TourPlayer.tsx';
import { findTour, type Tour, toursFor, WELCOME } from './tours.ts';
import { Finale, Welcome } from './Welcome.tsx';
import './tutorial.css';

type Playable = Omit<Tour, 'group' | 'icon'>;

export const TUTORIAL_SETTINGS = '/settings?section=tutorials';
const OFFER_EVERY_MS = 1200;

/**
 * The tutorials of a signed-in person (#502): the welcome on first sign-in, the pill that offers
 * a feature's tour the first time it is on screen, and the replays asked for in Settings.
 */
export function TutorialHost({
  admin,
  ready,
  pathname,
  search,
  firstProject,
  settingsOpen,
  closeSettings,
  closeInbox,
}: {
  admin: boolean;
  /** False until the instance is set up, for its administrator: the welcome waits. */
  ready: boolean;
  /** Path of the page under the settings window, so replays know whether a board is open. */
  pathname: string;
  /** Its query: the view of the board on screen. */
  search: string;
  /** Where the guided tour goes to find a board, from a page without one. */
  firstProject: string | undefined;
  settingsOpen: boolean;
  closeSettings: () => void;
  /** Closes the Inbox over the page, for a tour of something else. */
  closeInbox: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, openInbox, openNewProject, canCreateProjects } = useProjects();
  const prefs = usePreferences();
  const demo = !!useContext(SessionContext)?.instance?.demo;
  const requested = useRequestedTour();
  const [welcome, setWelcome] = useState(false);
  const [finale, setFinale] = useState(false);
  const [playing, setPlaying] = useState<Pick<Tour, 'id' | 'steps'> | null>(null);
  // The guided tour opened a project: its board loads before the steps are chosen.
  const [settle, setSettle] = useState<string[] | undefined>();
  // A tour started from Settings opened its screen: it plays once that is there.
  const [screen, setScreen] = useState<string[] | undefined>();
  const [pill, setPill] = useState<Tour | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const loaded = preferencesLoaded();
  const seen = prefs.tutorialsSeen;
  const modulesOff = prefs.modulesOff;
  const busy = welcome || finale || !!playing;
  // Each start from Settings supersedes the one before; so does leaving the page it started on.
  // A start still waiting for the boards then does nothing when they arrive.
  const startCount = useRef(0);
  const pageNow = useRef(pathname);
  pageNow.current = pathname;

  const say = useCallback(
    (text: string, open?: boolean, ok?: boolean) =>
      setToast({
        id: Date.now(),
        text,
        ok,
        onOpen: open ? () => navigate(TUTORIAL_SETTINGS) : undefined,
      }),
    [navigate],
  );
  const closeToast = useCallback(() => setToast(null), []);

  const startWelcomeTour = useCallback(() => {
    startCount.current++;
    // The tour shows a board: from a page without one, open the first project.
    const opens = !pathname.startsWith('/p/') && !!firstProject;
    if (opens) navigate(`/p/${firstProject}`);
    else if (settingsOpen) closeSettings();
    setSettle(opens ? ['dock', 'card'] : undefined);
    setScreen(undefined);
    setPlaying(WELCOME);
  }, [pathname, firstProject, settingsOpen, closeSettings, navigate]);

  /** Plays a tour once its screen, just opened, is there. */
  const playOn = useCallback((tour: Playable) => {
    setSettle(undefined);
    setScreen(screenOf(tour));
    setPlaying(tour);
  }, []);

  /**
   * Opens the board a tour describes, in the project on screen (else the first one), and plays
   * it there. A project without that board offers to make it, or says what is missing, where
   * the tour was asked for (the toast stays in the settings window).
   */
  const openBoardFor = useCallback(
    async (tour: Playable) => {
      const all = startViews(typeof tour.start === 'object' ? tour.start.view : undefined);
      const views = enabledViews(all, modulesOff);
      const started = startCount.current;
      const from = pathname;
      const [, onProject, onBoard] = pathname.match(/^\/p\/([^/]+)(?:\/b\/([^/]+))?/) ?? [];
      const projectId = onProject ?? projects?.[0]?.id;
      if (!projectId) {
        setToast({
          id: Date.now(),
          text: t('tutorial.start.noProject'),
          onOpen: canCreateProjects
            ? () => {
                if (settingsOpen) closeSettings();
                openNewProject();
              }
            : undefined,
          action: t('tutorial.start.newProject'),
        });
        return;
      }
      const [boards, counts] = await Promise.all([
        loadBoards(projectId),
        api
          .get<{ items: BoardCount[] }>(`/projects/${projectId}/board-counts`)
          .then((page) => new Map(page.items.map((c) => [c.boardId, c])))
          .catch(() => new Map<string, BoardCount>()),
      ]);
      if (started !== startCount.current || from !== pageNow.current) return;
      // Without the list nothing is known to be missing: never offer to make a board that exists.
      if (!boards) {
        setToast({ id: Date.now(), text: t('tutorial.start.boardsError') });
        return;
      }
      const rootBoardId = boards.find((b) => b.parentBoardId === null)?.id;
      const current = onProject ? (onBoard ?? rootBoardId) : undefined;
      // A board of a module that is off still shows what it holds: second choice.
      const board =
        startBoard(boards, counts, views, current) ?? startBoard(boards, counts, all, current);
      if (!board) {
        const project = projects?.find((p) => p.id === projectId);
        // Only a kind whose module is on is offered (decision 0121).
        const make =
          views
            .map((v) => kindFor(v, modulesOff))
            .find((kind) => kind && !boards.some((b) => b.kind === kind)) ?? null;
        const view = views.find((v) => kindFor(v) === make);
        const editor = project?.myRole === 'owner' || project?.myRole === 'editor';
        setToast({
          id: Date.now(),
          text: make ? t(`tutorial.start.missing.${make}`) : t(`tutorial.tours.${tour.id}.where`),
          action: t('tutorial.start.create'),
          onOpen:
            make && project && editor
              ? () =>
                  void addBoard(project, make, t).then(
                    (to) => {
                      navigate(view && view !== defaultView(make) ? `${to}?view=${view}` : to);
                      playOn(tour);
                    },
                    () => say(t('board.errors.boardCreate')),
                  )
              : undefined,
        });
        return;
      }
      const on = boardViews(board, counts.get(board.id));
      const view = views.find((v) => on.includes(v)) ?? all.find((v) => on.includes(v));
      const to = view
        ? viewHref(projectId, board, view, rootBoardId)
        : boardPath(projectId, board.id, rootBoardId);
      const here =
        board.id === current &&
        (!view || view === (new URLSearchParams(search).get('view') ?? defaultView(board.kind)));
      if (here) {
        if (settingsOpen) closeSettings();
      } else navigate(to);
      playOn(tour);
    },
    [
      pathname,
      search,
      projects,
      modulesOff,
      canCreateProjects,
      openNewProject,
      settingsOpen,
      closeSettings,
      navigate,
      playOn,
      say,
      t,
    ],
  );

  // First sign-in, once the account's preferences are known (another device may have seen it).
  useEffect(() => {
    if (!loaded || !ready || busy || settingsOpen || seen.includes(WELCOME.id)) return;
    if (autoOffers()) setWelcome(true);
  }, [loaded, ready, busy, settingsOpen, seen]);

  // A replay from Settings: go where the feature lives, or back to the page, then play.
  useEffect(() => {
    if (!requested) return;
    requestTour(null);
    const tour = findTour(requested);
    if (!tour) return;
    startCount.current++;
    setPill(null);
    // The Inbox covers the page: a tour of anything else plays without it.
    if (tour.start !== 'inbox') closeInbox();
    if (tour.id === WELCOME.id) {
      startWelcomeTour();
      return;
    }
    if (tour.href) {
      navigate(tour.href);
      playOn(tour);
      return;
    }
    if (tour.start && tour.start !== 'inbox') {
      void openBoardFor(tour);
      return;
    }
    if (settingsOpen) closeSettings();
    if (tour.start === 'inbox') {
      openInbox();
      playOn(tour);
      return;
    }
    setSettle(undefined);
    setScreen(undefined);
    setPlaying(tour);
  }, [
    requested,
    settingsOpen,
    closeSettings,
    navigate,
    startWelcomeTour,
    playOn,
    openBoardFor,
    openInbox,
    closeInbox,
  ]);

  // The pill: the first unseen tour whose place is on screen; it leaves with that place.
  useEffect(() => {
    if (!loaded || busy || !prefs.tutorialHints || !seen.includes(WELCOME.id) || !autoOffers())
      return;
    const look = () => {
      setPill((shown) => {
        if (shown) return shown.offer && findAnchor(shown.offer) ? shown : null;
        return (
          toursFor(admin, demo, prefs.modulesOff).find(
            (tour) => tour.offer && !seen.includes(tour.id) && findAnchor(tour.offer),
          ) ?? null
        );
      });
    };
    look();
    const timer = setInterval(look, OFFER_EVERY_MS);
    return () => clearInterval(timer);
  }, [loaded, busy, prefs.tutorialHints, prefs.modulesOff, seen, admin, demo]);

  const name = (id: string) => t(`tutorial.tours.${id}.name`);
  const ended = (finished: boolean) => {
    const tour = playing;
    setPlaying(null);
    if (!tour) return;
    markSeen(tour.id);
    if (tour.id === WELCOME.id) {
      if (finished) setFinale(true);
      else say(t('tutorial.toast.tourSkipped'), true);
    } else if (finished) say(t('tutorial.toast.done', { name: name(tour.id) }), false, true);
    else say(t('tutorial.toast.tourSkipped'), true);
  };

  return (
    <>
      {welcome && (
        <Welcome
          onTour={() => {
            setWelcome(false);
            startWelcomeTour();
          }}
          onSkip={() => {
            setWelcome(false);
            markSeen(WELCOME.id);
            say(t('tutorial.toast.welcomeSkipped'), true);
          }}
        />
      )}
      {playing && (
        <TourPlayer
          key={playing.id}
          tour={playing}
          settle={settle}
          screen={screen}
          onAbsent={() => {
            // The screen did not open (a panel to open, nothing on it yet): say what it needs.
            const id = playing.id;
            setPlaying(null);
            say(
              t(
                typeof findTour(id)?.start === 'object'
                  ? `tutorial.tours.${id}.where`
                  : 'tutorial.start.unavailable',
                { name: name(id) },
              ),
            );
          }}
          onEnd={ended}
        />
      )}
      {finale && (
        <Finale
          more={Math.max(0, toursFor(admin, demo, prefs.modulesOff).length - 4)}
          onClose={() => setFinale(false)}
        />
      )}
      {pill && !busy && !toast && (
        <TourPill
          key={pill.id}
          text={t('tutorial.pill.question', { name: name(pill.id) })}
          action={t('tutorial.pill.go')}
          onGo={() => {
            startCount.current++;
            setPill(null);
            setSettle(undefined);
            setScreen(undefined);
            setPlaying(pill);
          }}
          onDismiss={() => {
            setPill(null);
            markSeen(pill.id);
            say(t('tutorial.toast.pillDismissed'), true);
          }}
        />
      )}
      {toast && !busy && <TourToast key={toast.id} toast={toast} onClose={closeToast} />}
    </>
  );
}
