// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ user: { id: 'user-a' } as { id: string } | null }));
vi.mock('../../lib/api.ts', () => ({ api: { get } }));
vi.mock('../../lib/session.tsx', () => ({ useSession: () => session }));

import { setSignedInId } from '../../lib/me.ts';
import { type KitScope, loadOtherKits, useOtherKits } from './project-kit.ts';

const entry = (kind: string, make: string) => ({
  key: `${kind}:${make}`,
  icon: { kind, make },
  modifiers: [],
  lenses: [],
});
const kit = (...makes: string[]) => ({ items: makes.map((m) => entry('cob', m)) });

afterEach(() => {
  get.mockReset();
  setSignedInId(null);
  session.user = { id: 'user-a' };
});

describe('loadOtherKits (decision 0114)', () => {
  it('asks for the other boards, leaving out kinds this build does not know', async () => {
    get.mockResolvedValueOnce({ items: [entry('cob', 'Aputure'), entry('hologram', 'Future')] });
    const got = await loadOtherKits('project-1', 'board-1', 'user-a');
    expect(get).toHaveBeenCalledWith('/projects/project-1/plan-kit?excludeBoardId=board-1');
    expect(got?.map((e) => e.icon.make)).toEqual(['Aputure']);
  });

  it('answers null when it cannot be read, and asks again the next time', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    expect(await loadOtherKits('project-2', 'board-1', 'user-a')).toBeNull();
    get.mockResolvedValueOnce(kit('Aputure'));
    expect((await loadOtherKits('project-2', 'board-1', 'user-a'))?.length).toBe(1);
  });

  it('never serves one person’s answer to another, and forgets them all when someone else signs in', async () => {
    get.mockResolvedValueOnce(kit('Aputure', 'Secret'));
    expect((await loadOtherKits('project-3', 'board-1', 'user-a'))?.length).toBe(2);
    // The same person within a minute: kept.
    expect((await loadOtherKits('project-3', 'board-1', 'user-a'))?.length).toBe(2);
    expect(get).toHaveBeenCalledTimes(1);
    // A guest of that board only, in the same browser: asked again, with their own answer.
    get.mockResolvedValueOnce(kit());
    expect(await loadOtherKits('project-3', 'board-1', 'guest-b')).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
    // Someone else signs in: nothing kept is served, not even to the first person.
    setSignedInId('user-a');
    setSignedInId('guest-b');
    get.mockResolvedValueOnce(kit('Aputure'));
    expect((await loadOtherKits('project-3', 'board-1', 'user-a'))?.length).toBe(1);
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe('useOtherKits (decision 0114)', () => {
  async function mount() {
    const seen: Array<{ makes: string[]; scope: KitScope }> = [];
    let props = { projectId: 'p', boardId: 'board-a', skip: false };
    const Probe = (p: typeof props) => {
      const { entries, scope } = useOtherKits(p.projectId, p.boardId, p.skip);
      seen.push({ makes: entries.map((e) => e.icon.make ?? ''), scope });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    const render = async (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      await act(async () => root.render(<Probe {...props} />));
      return seen.at(-1);
    };
    return { render, unmount: () => act(async () => root.unmount()) };
  }

  it('shows nothing of another board, project or person while the new kit loads', async () => {
    get.mockResolvedValueOnce(kit('From A'));
    const probe = await mount();
    expect(await probe.render({})).toEqual({ makes: ['From A'], scope: 'all' });
    // Another board: the first board's kit is gone while its own loads.
    let answer: (v: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((r) => (answer = r)));
    expect(await probe.render({ boardId: 'board-b' })).toEqual({ makes: [], scope: 'loading' });
    await act(async () => answer(kit('From B')));
    expect(await probe.render({})).toEqual({ makes: ['From B'], scope: 'all' });
    // Closed (or a guest link): nothing kept on screen.
    expect(await probe.render({ skip: true })).toEqual({ makes: [], scope: 'local' });
    // Nobody signed in: nothing asked, nothing shown.
    session.user = null;
    expect(await probe.render({ skip: false })).toEqual({ makes: [], scope: 'local' });
    expect(get).toHaveBeenCalledTimes(2);
    await probe.unmount();
  });
});
