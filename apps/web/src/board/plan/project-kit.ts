// SPDX-License-Identifier: AGPL-3.0-only
import type { ProjectKitEntry } from '@inkadra/canvas-core';
import { PLAN_ICON_KINDS } from '@inkadra/doc-schema';
import type { PlanKit } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

/**
 * Where the project kit of the editor comes from (decision 0114): `all` when the other boards'
 * kit arrived, `loading` while it is asked, `local` when it cannot be (offline, the server
 * refused, a guest link): then the kit is this board's only, and the panel says so.
 */
export type KitScope = 'all' | 'loading' | 'local';

const requests = new Map<string, Promise<ProjectKitEntry[] | null>>();
const FRESH_MS = 60_000;
const KINDS = new Set<string>(PLAN_ICON_KINDS);

/**
 * The kit of the plans of the other boards of a project the person can read, from the server;
 * null when it cannot be read. shortcut: kept for a minute, so a light set up on another board
 * can show late.
 */
export function loadOtherKits(projectId: string, boardId: string) {
  const key = `${projectId}:${boardId}`;
  let request = requests.get(key);
  if (!request) {
    request = api
      .get<PlanKit>(`/projects/${projectId}/plan-kit?excludeBoardId=${boardId}`)
      // Kinds a newer server knows and this build does not are left out.
      .then((result) => result.items.filter((e) => KINDS.has(e.icon.kind)) as ProjectKitEntry[])
      .catch(() => {
        requests.delete(key);
        return null;
      });
    requests.set(key, request);
    setTimeout(() => requests.delete(key), FRESH_MS);
  }
  return request;
}

/** The other boards' kit and where it stands; nothing is asked on a guest link. */
export function useOtherKits(
  projectId: string,
  boardId: string,
  skip: boolean,
): { entries: readonly ProjectKitEntry[]; scope: KitScope } {
  const [state, setState] = useState<{ entries: readonly ProjectKitEntry[]; scope: KitScope }>({
    entries: [],
    scope: skip ? 'local' : 'loading',
  });
  // Back online, it is asked again.
  const [online, setOnline] = useState(0);
  useEffect(() => {
    const on = () => setOnline((n) => n + 1);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  useEffect(() => {
    if (skip) return;
    void online;
    let live = true;
    setState((s) => ({ ...s, scope: 'loading' }));
    void loadOtherKits(projectId, boardId).then((entries) => {
      if (live) setState(entries ? { entries, scope: 'all' } : { entries: [], scope: 'local' });
    });
    return () => {
      live = false;
    };
  }, [projectId, boardId, skip, online]);
  return state;
}
