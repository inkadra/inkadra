// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import type { CrewMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../../lib/api.ts';
import { ExportCache } from '../export/cache.ts';
import { loadPlanning } from '../export/planning.ts';
import { loadCrew, useCrew } from './day-calls.ts';
import { emptyCrewMember } from './TroupeView.tsx';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  vi.restoreAllMocks();
});
let state: ReturnType<typeof useCrew>;
function Probe() {
  state = useCrew('p', 'here');
  return null;
}
const crew = {
  ...emptyCrewMember('Anna', 0),
  id: 'person',
  projectId: 'p',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  character: { boardId: 'other', elementId: 'c' },
} as CrewMember;
it.each([false, true])(
  'refreshes linked characters and recovers (first fetch fails: %s)',
  async (initialFailure) => {
    let name = 'Before';
    let fail = initialFailure;
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path.endsWith('/characters')) {
        if (fail) throw new Error('offline');
        return { items: [{ ...crew.character, name, actor: '', contact: '' }] };
      }
      return { items: [crew] };
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    cleanup.push(() => act(() => root.unmount()));
    await act(async () => root.render(<Probe />));
    if (initialFailure) {
      expect(state!.failed).toBe(true);
      fail = false;
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    }
    expect(state!.characters[0]?.name).toBe('Before');
    name = 'After';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(state!.characters[0]?.name).toBe('After');
    fail = true;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    fail = false;
    name = 'Recovered';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(state!.characters[0]?.name).toBe('Recovered');
  },
);
it.each(['crew', 'characters', 'schedule'])(
  'rejects an incomplete print after a %s service failure',
  async (failure) => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if ((failure === 'crew' && path.endsWith('/crew')) || path.endsWith(`/${failure}`))
        throw new RequestError(500, 'internal', 'unavailable');
      return { items: [crew] };
    });
    await expect(
      failure === 'schedule' ? loadPlanning('b') : loadCrew('p', 'here'),
    ).rejects.toThrow('unavailable');
  },
);
it.each([403, 404])('allows a print without inaccessible roster data (%s)', async (status) => {
  vi.spyOn(api, 'get').mockRejectedValue(new RequestError(status, 'forbidden', 'private'));
  await expect(loadCrew('p', 'b')).resolves.toEqual({ crew: [], characters: [] });
  await expect(loadPlanning('b')).resolves.toEqual({ days: [] });
});
it('retries failed preview data rather than caching a rejected request', async () => {
  const cache = new ExportCache();
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  await expect(cache.once('planning', load)).rejects.toThrow();
  await expect(cache.once('planning', load)).resolves.toEqual([]);
});
