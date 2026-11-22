import type { HocuspocusProvider } from '@hocuspocus/provider';
import {
  type LocalPresence,
  type PresenceState,
  presenceColor,
  readPresence,
} from '@inkadra/doc-schema';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export interface Peer extends PresenceState {
  clientId: number;
  color: string;
}

/** Colours people get on a board, the same on every client (cursor, avatar ring, outline). */
export const PEER_COLORS = [
  'var(--ink-tag-blue)',
  'var(--ink-tag-orange)',
  'var(--ink-tag-purple)',
  'var(--ink-tag-green)',
  'var(--ink-status-warn)',
  'var(--ink-status-danger)',
] as const;

export const peerColor = (userId: string) =>
  PEER_COLORS[presenceColor(userId, PEER_COLORS.length)] ?? PEER_COLORS[0];

/**
 * Other people on the board as a store: one entry per open tab, as the server stamped them. A
 * component reads only what it draws (`usePeers`), so a pointer moving re-renders the cursors,
 * never the whole canvas.
 */
export interface PeerSource {
  subscribe(onChange: () => void): () => void;
  /** The same array until awareness changes. */
  get(): readonly Peer[];
}

const NONE: readonly Peer[] = [];

/** A board without anyone else: previews and guest pages. */
export const NO_PEERS: PeerSource = { subscribe: () => () => {}, get: () => NONE };

/** The people on a connection's board, read from its awareness while anything listens. */
export function peerSource(provider: HocuspocusProvider): PeerSource {
  let peers = NONE;
  const listeners = new Set<() => void>();
  const read = () => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const next: Peer[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const p = readPresence(state);
      if (p) next.push({ ...p, clientId, color: peerColor(p.user.id) });
    }
    peers = next;
  };
  const changed = () => {
    read();
    for (const listener of listeners) listener();
  };
  return {
    subscribe(onChange) {
      const awareness = provider.awareness;
      if (!awareness) return () => {};
      if (listeners.size === 0) {
        read();
        awareness.on('change', changed);
      }
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) awareness.off('change', changed);
      };
    },
    get: () => peers,
  };
}

/** A source for this provider, the same one across renders. */
export function usePeerSource(provider: HocuspocusProvider): PeerSource {
  return useMemo(() => peerSource(provider), [provider]);
}

/**
 * What a component draws of the people on the board. With `select` and `equal`, it re-renders
 * only when the selected value changes (`select` must keep its identity, e.g. `useCallback`).
 */
export function usePeers(source: PeerSource): readonly Peer[];
export function usePeers<T>(
  source: PeerSource,
  select: (peers: readonly Peer[]) => T,
  equal: (a: T, b: T) => boolean,
): T;
export function usePeers<T>(
  source: PeerSource,
  select?: (peers: readonly Peer[]) => T,
  equal?: (a: T, b: T) => boolean,
): T | readonly Peer[] {
  const last = useRef<{ peers: readonly Peer[]; select: unknown; value: T } | null>(null);
  const get = () => {
    const peers = source.get();
    if (!select || !equal) return peers;
    const prev = last.current;
    if (prev?.peers === peers && prev.select === select) return prev.value;
    const value = select(peers);
    const kept = prev && equal(prev.value, value) ? prev.value : value;
    last.current = { peers, select, value: kept };
    return kept;
  };
  return useSyncExternalStore(source.subscribe, get);
}

/** The selections and cards being edited of each tab: what the outlines draw. */
export function selections(peers: readonly Peer[]) {
  return peers
    .filter((p) => p.selection.length > 0)
    .map(({ clientId, color, selection, editing }) => ({ clientId, color, selection, editing }));
}

export function sameSelections(
  a: ReturnType<typeof selections>,
  b: ReturnType<typeof selections>,
): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return (
        !!q &&
        p.clientId === q.clientId &&
        p.color === q.color &&
        p.editing === q.editing &&
        sameIds(p.selection, q.selection)
      );
    })
  );
}

/** The same people, in the same order. */
export function samePeople(a: readonly Peer[], b: readonly Peer[]): boolean {
  return sameIds(
    a.map((p) => p.user.id),
    b.map((p) => p.user.id),
  );
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** People typing in a note right now, each once; the server never marks viewers. */
export function typingIn(peers: readonly Peer[], elementId: string): Peer[] {
  return uniquePeople(peers.filter((p) => p.editing === elementId && p.typing && !p.readOnly));
}

/** How long after the last key someone still counts as typing. */
export const TYPING_PAUSE_MS = 2000;

/** One avatar per person, even with several tabs open; editors before viewers. */
export function uniquePeople(peers: readonly Peer[]): Peer[] {
  const byUser = new Map<string, Peer>();
  for (const p of peers) {
    const seen = byUser.get(p.user.id);
    if (!seen || (seen.readOnly && !p.readOnly)) byUser.set(p.user.id, p);
  }
  return [...byUser.values()].sort((a, b) => Number(a.readOnly) - Number(b.readOnly));
}

const CURSOR_EVERY_MS = 50;

/**
 * Publishes this client's pointer, selection and editing state. The pointer is sent at most
 * every 50 ms; the server adds who we are.
 */
export function useLocalPresence(provider: HocuspocusProvider | null) {
  const publisher = useMemo(() => {
    const state: LocalPresence = { cursor: null, selection: [], editing: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSent = 0;
    const flush = () => {
      lastSent = Date.now();
      provider?.awareness?.setLocalState({ ...state });
    };
    return {
      flush,
      stop() {
        clearTimeout(timer);
        provider?.awareness?.setLocalState(null);
      },
      cursor(at: { x: number; y: number } | null) {
        state.cursor = at;
        clearTimeout(timer);
        const wait = CURSOR_EVERY_MS - (Date.now() - lastSent);
        if (wait <= 0 || at === null) flush();
        else timer = setTimeout(flush, wait);
      },
      selection(ids: string[], editing: string | null) {
        state.selection = ids.slice(0, 500);
        if (state.editing !== editing) state.typing = false;
        state.editing = editing;
        flush();
      },
      /** Writing in a note outside the canvas (the full-screen note); typing while keys go. */
      writing(elementId: string | null, typing: boolean) {
        if (state.editing === elementId && (state.typing ?? false) === typing) return;
        state.editing = elementId;
        state.typing = elementId !== null && typing;
        flush();
      },
    };
  }, [provider]);

  useEffect(() => {
    publisher.flush();
    return () => publisher.stop();
  }, [publisher]);

  return publisher;
}
