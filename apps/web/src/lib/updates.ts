import type { InstanceUpdates } from '@inkadra/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { usePreferences } from './preferences.ts';
import { useSession } from './session.tsx';

/**
 * New Inkadra releases, for administrators (#515, decision 0079). The server reads GitHub and
 * caches the answer; the page, the settings navigation and the pop-up share one copy here.
 */
type State = { data: InstanceUpdates | null; error: boolean; checking: boolean };

let state: State = { data: null, error: false, checking: false };
let requested = false;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const read = () => state;

export async function loadUpdates() {
  requested = true;
  try {
    set({ data: await api.get<InstanceUpdates>('/instance/updates'), error: false });
  } catch {
    set({ error: true });
  }
}

/** "Check now": GitHub is asked again, at most once a minute. */
export async function checkUpdatesNow() {
  set({ checking: true });
  try {
    set({ data: await api.post<InstanceUpdates>('/instance/updates/check', {}), error: false });
  } catch {
    set({ error: true });
  } finally {
    set({ checking: false });
  }
}

/** Tests only. */
export function resetUpdates() {
  state = { data: null, error: false, checking: false };
  requested = false;
}

/** The updates, read once per session for administrators; null for everyone else. */
export function useUpdates(): State {
  const { user } = useSession();
  const admin = user?.role === 'admin';
  useEffect(() => {
    if (admin && !requested) void loadUpdates();
  }, [admin]);
  const current = useSyncExternalStore(subscribe, read, read);
  return admin ? current : { data: null, error: false, checking: false };
}

/** The release to point administrators at, unless they skipped it. */
export function usePendingUpdate() {
  const { data } = useUpdates();
  const { updateSkipped } = usePreferences();
  const available = data?.available ?? null;
  return available && available.version !== updateSkipped ? available : null;
}
