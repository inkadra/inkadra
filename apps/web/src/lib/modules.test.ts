// SPDX-License-Identifier: AGPL-3.0-only
import { readUserPreferences } from '@inkadra/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { getPreferences } from './preferences.ts';

// The server answers with what it saved: here, the patch over the defaults.
const saved = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./api.ts', () => ({
  api: {
    patch: vi.fn(async (_path: string, patch: Record<string, unknown>) => {
      saved.value = { ...saved.value, ...patch };
      return saved.value;
    }),
  },
}));

const { setModule, takeModuleNotice } = await import('./modules.ts');

beforeEach(() => {
  saved.value = {};
});

it('shows the short notice of a module once per person (decision 0121)', async () => {
  expect(getPreferences().moduleNotices).toEqual([]);
  expect(takeModuleNotice('storyboard')).toBe(true);
  expect(takeModuleNotice('storyboard')).toBe(false);
  await vi.waitFor(() => expect(saved.value.moduleNotices).toEqual(['storyboard']));
  expect(readUserPreferences(saved.value).moduleNotices).toEqual(['storyboard']);
});

it('turns a module off and on in the preferences, all on by default', async () => {
  expect(getPreferences().modulesOff).toEqual([]);
  await setModule('plan', false);
  expect(getPreferences().modulesOff).toEqual(['plan']);
  await setModule('plan', true);
  expect(getPreferences().modulesOff).toEqual([]);
});
