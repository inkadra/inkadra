import type { FrameElement } from '@inkadra/canvas-core';
import { useTranslation } from 'react-i18next';
import { GuestVisibilityIcon, toggleGuestHidden } from '../guest-visibility.tsx';
import type { BoardStore } from '../store.ts';

/**
 * Only editors of the live board can change a frame's explicit visibility. The toggle shows on
 * hidden frames, and on hover or focus of its card or row (`.guest-toggle` in film.css).
 */
export function FrameVisibilityButton({
  store,
  frame,
  readOnly,
}: {
  store: BoardStore;
  frame: FrameElement;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  if (readOnly) return null;
  return (
    <button
      type="button"
      className="ink-iconbtn guest-toggle"
      aria-label={t('guestVisibility.hide')}
      title={t('guestVisibility.hide')}
      aria-pressed={!!frame.guestHidden}
      onClick={() => toggleGuestHidden(store, [frame.id])}
    >
      <GuestVisibilityIcon />
    </button>
  );
}
