// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { type GuestActions, GuestActionsContext } from './actions.ts';
import { GuestRequestError } from './api.ts';
import { PickControls } from './GuestCardExtras.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('words a failed pick with the guest catalogue, never the server’s text (#830)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const notify = vi.fn();
  const actions = {
    picks: new Map(),
    pick: () => Promise.reject(new GuestRequestError(502, 'unknown', 'Bad Gateway', null, null)),
    withName: (action: () => unknown) => void action(),
    fail: () => 'guest.errors.offline',
    notify,
  } as unknown as GuestActions;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <GuestActionsContext.Provider value={actions}>
        <PickControls elementId="e1" />
      </GuestActionsContext.Provider>,
    ),
  );
  await act(async () => host.querySelector('button')?.click());
  expect(notify).toHaveBeenCalledWith('guest.errors.offline');
  expect(notify).not.toHaveBeenCalledWith('Bad Gateway');
  await act(async () => root.unmount());
  host.remove();
});
