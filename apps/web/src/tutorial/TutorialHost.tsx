import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { preferencesLoaded, usePreferences } from '../lib/preferences.ts';
import { type ToastMessage, TourPill, TourToast } from './Pill.tsx';
import { autoOffers, markSeen, requestTour, useRequestedTour } from './state.ts';
import { findAnchor, TourPlayer } from './TourPlayer.tsx';
import { findTour, type Tour, toursFor, WELCOME } from './tours.ts';
import { Finale, Welcome } from './Welcome.tsx';
import './tutorial.css';

export const TUTORIAL_SETTINGS = '/settings?section=tutorials';
const OFFER_EVERY_MS = 1200;

/**
 * The tutorials of a signed-in person (#502): the welcome on first sign-in, the pill that offers
 * a feature's tour the first time it is on screen, and the replays asked for in Settings.
 */
export function TutorialHost({
  admin,
  ready,
  firstProject,
  settingsOpen,
  closeSettings,
}: {
  admin: boolean;
  /** False until the instance is set up, for its administrator: the welcome waits. */
  ready: boolean;
  /** Where the guided tour goes to find a board, from a page without one. */
  firstProject: string | undefined;
  settingsOpen: boolean;
  closeSettings: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const prefs = usePreferences();
  const requested = useRequestedTour();
  const [welcome, setWelcome] = useState(false);
  const [finale, setFinale] = useState(false);
  const [playing, setPlaying] = useState<Pick<Tour, 'id' | 'steps'> | null>(null);
  // The guided tour opened a project: its board loads before the steps are chosen.
  const [settle, setSettle] = useState<string[] | undefined>();
  const [pill, setPill] = useState<Tour | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const loaded = preferencesLoaded();
  const seen = prefs.tutorialsSeen;
  const busy = welcome || finale || !!playing;

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
    // The tour shows a board: from a page without one, open the first project.
    const opens = !pathname.startsWith('/p/') && !!firstProject;
    if (opens) navigate(`/p/${firstProject}`);
    setSettle(opens ? ['dock', 'card'] : undefined);
    setPlaying(WELCOME);
  }, [pathname, firstProject, navigate]);

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
    setPill(null);
    if (tour.href) navigate(tour.href);
    else if (settingsOpen) closeSettings();
    if (tour.id === WELCOME.id) startWelcomeTour();
    else {
      setSettle(undefined);
      setPlaying(tour);
    }
  }, [requested, settingsOpen, closeSettings, navigate, startWelcomeTour]);

  // The pill: the first unseen tour whose place is on screen; it leaves with that place.
  useEffect(() => {
    if (!loaded || busy || !prefs.tutorialHints || !seen.includes(WELCOME.id) || !autoOffers())
      return;
    const look = () => {
      setPill((shown) => {
        if (shown) return shown.offer && findAnchor(shown.offer) ? shown : null;
        return (
          toursFor(admin).find(
            (tour) => tour.offer && !seen.includes(tour.id) && findAnchor(tour.offer),
          ) ?? null
        );
      });
    };
    look();
    const timer = setInterval(look, OFFER_EVERY_MS);
    return () => clearInterval(timer);
  }, [loaded, busy, prefs.tutorialHints, seen, admin]);

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
      {playing && <TourPlayer key={playing.id} tour={playing} settle={settle} onEnd={ended} />}
      {finale && (
        <Finale more={Math.max(0, toursFor(admin).length - 4)} onClose={() => setFinale(false)} />
      )}
      {pill && !busy && !toast && (
        <TourPill
          key={pill.id}
          text={t('tutorial.pill.question', { name: name(pill.id) })}
          action={t('tutorial.pill.go')}
          onGo={() => {
            setPill(null);
            setSettle(undefined);
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
