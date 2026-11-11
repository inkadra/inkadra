// SPDX-License-Identifier: AGPL-3.0-only
import type { ProjectKitEntry } from '@inkadra/canvas-core';
import { PLAN_ICON_KINDS } from '@inkadra/doc-schema';
import type { PlanKit } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { onSignedInChange } from '../../lib/me.ts';
import { useSession } from '../../lib/session.tsx';

/**
 * Where the project kit of the editor comes from (decision 0114): `all` when the other boards'
 * kit arrived, `loading` while it is asked, `local` when it cannot be (offline, the server
 * refused, nobody signed in, a guest link): then the kit is this board's only, and the panel
 * says so.
 */
export type KitScope = 'all' | 'loading' | 'local';

const FRESH_MS = 60_000;
const KINDS = new Set<string>(PLAN_ICON_KINDS);
/** Answers by person, project and board, with when they were asked. */
const requests = new Map<string, { at: number; answer: Promise<ProjectKitEntry[] | null> }>();
// What one person may read is never served to another in the same browser.
onSignedInChange(() => requests.clear());

/**
 * The kit of the plans of the other boards of a project that `userId` can read, from the server;
 * null when it cannot be read. shortcut: kept for a minute per person, so a light set up on
 * another board can show late.
 */
export function loadOtherKits(projectId: string, boardId: string, userId: string) {
  const key = JSON.stringify([userId, projectId, boardId]);
  const now = Date.now();
  const kept = requests.get(key);
  if (kept && now - kept.at < FRESH_MS) return kept.answer;
  const answer = api
    .get<PlanKit>(`/projects/${projectId}/plan-kit?excludeBoardId=${boardId}`)
    // Kinds a newer server knows and this build does not are left out.
    .then((result) => result.items.filter((e) => KINDS.has(e.icon.kind)) as ProjectKitEntry[])
    .catch(() => {
      if (requests.get(key)?.answer === answer) requests.delete(key);
      return null;
    });
  requests.set(key, { at: now, answer });
  return answer;
}

type Kits = { entries: readonly ProjectKitEntry[]; scope: KitScope };

/**
 * The other boards' kit and where it stands, for the person signed in. Nothing is asked when
 * `skip` (the editor closed) or nobody is signed in (a guest link); the kit of another board,
 * project or person is never shown while the new one loads.
 */
export function useOtherKits(projectId: string, boardId: string, skip: boolean): Kits {
  const userId = useSession().user?.id ?? null;
  const key = skip || !userId ? null : JSON.stringify([userId, projectId, boardId]);
  const [state, setState] = useState<Kits & { key: string | null }>({
    key: null,
    entries: [],
    scope: 'local',
  });
  // Back online, it is asked again.
  const [online, setOnline] = useState(0);
  useEffect(() => {
    const on = () => setOnline((n) => n + 1);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  useEffect(() => {
    if (!key || !userId) return;
    void online;
    let live = true;
    void loadOtherKits(projectId, boardId, userId).then((entries) => {
      if (live)
        setState(entries ? { key, entries, scope: 'all' } : { key, entries: [], scope: 'local' });
    });
    return () => {
      live = false;
    };
  }, [key, projectId, boardId, userId, online]);
  if (!key) return { entries: [], scope: 'local' };
  return state.key === key ? state : { entries: [], scope: 'loading' };
}
