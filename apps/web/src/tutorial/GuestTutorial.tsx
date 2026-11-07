import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ToastMessage, TourPill, TourToast } from './Pill.tsx';
import { autoOffers, guestSeen, markGuestSeen } from './state.ts';
import { findAnchor, TourPlayer } from './TourPlayer.tsx';
import { GUEST } from './tours.ts';
import './tutorial.css';

/**
 * The guest of a link that asks for comments or a decision (#502): a pill offers two steps, and
 * "?" in the header plays them again. No welcome: guests have no account.
 */
export function GuestTutorial({ sharedBy }: { sharedBy: string | null }) {
  const { t } = useTranslation();
  const [pill, setPill] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (guestSeen() || !autoOffers()) return;
    // The board loads after the page: offer once its canvas is there.
    const timer = setInterval(() => {
      if (!findAnchor(GUEST.offer as string)) return;
      clearInterval(timer);
      setPill(true);
    }, 600);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <button
        type="button"
        className="ink-iconbtn tour-help"
        aria-label={t('tutorial.guest.help')}
        data-ink-tooltip={t('tutorial.guest.help')}
        onClick={() => {
          setPill(false);
          setPlaying(true);
        }}
      >
        ?
      </button>
      {pill && !playing && (
        <TourPill
          text={
            sharedBy
              ? t('tutorial.guest.question', { name: sharedBy })
              : t('tutorial.guest.questionAnonymous')
          }
          action={t('tutorial.guest.go')}
          onGo={() => {
            setPill(false);
            setPlaying(true);
          }}
          onDismiss={() => {
            setPill(false);
            markGuestSeen();
            setToast({ id: Date.now(), text: t('tutorial.toast.guestDismissed') });
          }}
        />
      )}
      {playing && (
        <TourPlayer
          tour={GUEST}
          onEnd={(finished) => {
            setPlaying(false);
            markGuestSeen();
            setToast({
              id: Date.now(),
              text: t(finished ? 'tutorial.toast.guestDone' : 'tutorial.toast.guestDismissed'),
              ok: finished,
            });
          }}
        />
      )}
      {toast && !playing && <TourToast key={toast.id} toast={toast} onClose={closeToast} />}
    </>
  );
}
