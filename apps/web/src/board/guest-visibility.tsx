import { updateElements } from '@inkadra/canvas-core';
import { hiddenFromGuests } from '@inkadra/doc-schema';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { type BoardStore, LOCAL } from './store.ts';

/** Only explicit flags change: inherited hiding is never copied onto children. */
export function toggleGuestHidden(store: BoardStore, ids: readonly string[]) {
  const elements = ids
    .map((id) => store.getSnapshot().byId.get(id))
    .filter((el) => el !== undefined && el.type !== 'arrow');
  const hide = elements.some((el) => !el.guestHidden);
  store.undo.stopCapturing();
  updateElements(
    store.doc,
    elements.map((el) => ({ id: el.id, patch: { guestHidden: hide ? true : undefined } })),
    LOCAL,
  );
  store.undo.stopCapturing();
}

/** A primitive subscription only re-renders an indicator when its effective visibility changes. */
export function GuestVisibility({ store, id }: { store: BoardStore; id: string }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(store.subscribe, () => {
    const byId = store.getSnapshot().byId;
    const el = byId.get(id);
    if (!el) return null;
    if (el.guestHidden) return 'hidden';
    // Most elements sit on the canvas: skip the walk up the containers for them.
    if (el.parent === null) return null;
    return hiddenFromGuests(id, (key) => byId.get(key)) ? 'inherited' : null;
  });
  if (!state) return null;
  const label = t(`guestVisibility.${state}`);
  return (
    <span
      className="guest-visibility"
      role="img"
      aria-label={label}
      title={label}
      data-guest-hidden={state}
    >
      <GuestVisibilityIcon />
    </span>
  );
}

/** Local UI glyph, matching the existing 24px line icon grid. */
export function GuestVisibilityIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18M10 5a10 10 0 0 1 11 7 14 14 0 0 1-3 4M6 6a14 14 0 0 0-3 6c4 7 10 9 15 6M10 10a3 3 0 0 0 4 4" />
    </svg>
  );
}
