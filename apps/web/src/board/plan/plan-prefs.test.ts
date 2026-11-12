// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_USER_PREFERENCES } from '@inkadra/shared';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RequestError } from '../../lib/api.ts';
import { setSignedInId } from '../../lib/me.ts';
import { resetPlanPrefs, usePlanPref } from './plan-prefs.ts';

const prefs = vi.hoisted(() => ({
  loaded: false,
  update: vi.fn<(patch: Record<string, unknown>) => Promise<void>>(),
  leave: vi.fn<(patch: Record<string, unknown>) => void>(),
}));
vi.mock('../../lib/preferences.ts', () => ({
  getPreferences: () => DEFAULT_USER_PREFERENCES,
  usePreferences: () => DEFAULT_USER_PREFERENCES,
  preferencesLoaded: () => prefs.loaded,
  updatePreferences: (patch: Record<string, unknown>) => prefs.update(patch),
  savePreferencesOnLeave: (patch: Record<string, unknown>) => prefs.leave(patch),
}));

let setSnap: (v: boolean | ((now: boolean) => boolean)) => void = () => {};
let shown: boolean | null = null;
function Probe() {
  const [snap, set] = usePlanPref('planSnap');
  setSnap = set;
  shown = snap;
  return null;
}
async function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
  return () => act(async () => root.unmount());
}

beforeEach(() => {
  vi.useFakeTimers();
  prefs.update.mockReset();
  prefs.update.mockResolvedValue();
  prefs.leave.mockReset();
  prefs.loaded = true;
  setSignedInId('personA');
});
afterEach(() => {
  resetPlanPrefs();
  setSignedInId(null);
  vi.useRealTimers();
});

it('keeps a guest’s choice for the session, without a request, across the editor closing', async () => {
  setSignedInId(null);
  prefs.loaded = false;
  let unmount = await mount();
  await act(async () => setSnap((v) => !v));
  expect(shown).toBe(false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).not.toHaveBeenCalled();
  await unmount();
  unmount = await mount();
  expect(shown).toBe(false);
  await unmount();
});

it('saves an account’s quick changes once', async () => {
  const unmount = await mount();
  await act(async () => {
    setSnap((v) => !v);
    setSnap((v) => !v);
    setSnap((v) => !v);
  });
  expect(prefs.update).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).toHaveBeenCalledTimes(1);
  expect(prefs.update).toHaveBeenCalledWith({ planSnap: false });
  await unmount();
});

it('never sends one person’s pending choice under another account, nor shows it to them', async () => {
  const unmount = await mount();
  await act(async () => setSnap(false));
  // Another person signs in on the tab before the save fires.
  await act(async () => setSignedInId('personB'));
  expect(shown).toBe(true);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).not.toHaveBeenCalled();
  await unmount();
});

it('drops a value the server refuses, keeps one a network failure left unsaved', async () => {
  const unmount = await mount();
  prefs.update.mockRejectedValueOnce(new RequestError(400, 'invalid', 'Invalid'));
  await act(async () => setSnap(false));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(shown).toBe(true);
  prefs.update.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => setSnap(false));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(shown).toBe(false);
  await unmount();
});

it('writes a pending choice when the page goes away', async () => {
  const unmount = await mount();
  await act(async () => setSnap(false));
  window.dispatchEvent(new Event('pagehide'));
  expect(prefs.leave).toHaveBeenCalledWith({ planSnap: false });
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).not.toHaveBeenCalled();
  await unmount();
});
