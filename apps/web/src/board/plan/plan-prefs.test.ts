// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_USER_PREFERENCES } from '@inkadra/shared';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetPlanPrefs, usePlanPref } from './plan-prefs.ts';

const prefs = vi.hoisted(() => ({
  loaded: false,
  update: vi.fn<(patch: Record<string, unknown>) => Promise<void>>(),
}));
vi.mock('../../lib/preferences.ts', () => ({
  getPreferences: () => DEFAULT_USER_PREFERENCES,
  usePreferences: () => DEFAULT_USER_PREFERENCES,
  preferencesLoaded: () => prefs.loaded,
  updatePreferences: (patch: Record<string, unknown>) => prefs.update(patch),
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
});
afterEach(() => {
  resetPlanPrefs();
  vi.useRealTimers();
});

it('keeps a guest’s choice for the session, without a request, across the editor closing', async () => {
  prefs.loaded = false;
  let unmount = await mount();
  await act(async () => setSnap((v) => !v));
  expect(shown).toBe(false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).not.toHaveBeenCalled();
  await unmount();
  // The editor opens again (another setup, or closed and reopened): the choice is still there.
  unmount = await mount();
  expect(shown).toBe(false);
  await unmount();
});

it('saves an account’s quick changes once, and keeps the choice when the save fails', async () => {
  prefs.loaded = true;
  const unmount = await mount();
  await act(async () => {
    setSnap((v) => !v);
    setSnap((v) => !v);
    setSnap((v) => !v);
  });
  expect(prefs.update).not.toHaveBeenCalled();
  prefs.update.mockRejectedValueOnce(new Error('offline'));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(prefs.update).toHaveBeenCalledTimes(1);
  expect(prefs.update).toHaveBeenCalledWith({ planSnap: false });
  // Refused: the choice stays for the session instead of jumping back.
  expect(shown).toBe(false);
  await unmount();
});
