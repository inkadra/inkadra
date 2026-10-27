import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string | undefined;
  run: () => void;
}

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** 3 = label starts with the query, 2 = a word starts with it, 1 = it appears inside, 0 = no match. */
export function matchRank(label: string, query: string): number {
  const q = normalize(query.trim());
  if (!q) return 1;
  const text = normalize(label);
  if (text.startsWith(q)) return 3;
  if (text.split(/[^\p{L}\p{N}]+/u).some((word, i) => i > 0 && word.startsWith(q))) return 2;
  return text.includes(q) ? 1 : 0;
}

/** Matching actions, best match first; equal matches keep their order. */
export function rankActions<T extends { label: string }>(
  actions: readonly T[],
  query: string,
): T[] {
  return actions
    .map((action, index) => ({ action, index, rank: matchRank(action.label, query) }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ action }) => action);
}

const scopes = new Map<string, PaletteAction[]>();
const listeners = new Set<() => void>();
let snapshot: PaletteAction[] = [];
function publish() {
  const byId = new Map<string, PaletteAction>();
  for (const action of [...scopes.values()].flat()) {
    if (byId.has(action.id) && import.meta.env.DEV) {
      console.warn(`Palette action "${action.id}" is registered twice; the last one wins.`);
    }
    byId.set(action.id, action);
  }
  snapshot = [...byId.values()];
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useContextActions = () => useSyncExternalStore(subscribe, () => snapshot);

/** Mounted owners supply their real handlers; wrappers always use the latest permission checks. */
export function useRegisterActions(actions: PaletteAction[]) {
  const id = useId();
  const latest = useRef(actions);
  const signature = JSON.stringify(actions.map(({ id, label, hint }) => [id, label, hint]));
  useEffect(() => {
    latest.current = actions;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature tracks visible metadata; handlers use the latest committed render.
  useEffect(() => {
    scopes.set(
      id,
      latest.current.map((action) => ({
        ...action,
        run: () => latest.current.find((current) => current.id === action.id)?.run(),
      })),
    );
    publish();
    return () => {
      scopes.delete(id);
      publish();
    };
  }, [id, signature]);
}

export function addActions<T extends string>(
  tools: readonly { type: T; key?: string }[],
  label: (type: T) => string,
  add: (type: T) => void,
): PaletteAction[] {
  return tools.map(({ type, key }) => ({
    id: `add-${type}`,
    label: label(type),
    hint: key,
    run: () => add(type),
  }));
}
