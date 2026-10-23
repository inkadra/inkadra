import type { HocuspocusProvider } from '@hocuspocus/provider';
import {
  type LocalPresence,
  type PresenceState,
  presenceColor,
  readPresence,
} from '@inkadra/doc-schema';
import { useEffect, useMemo, useState } from 'react';

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

/** Other people on the board: one entry per open tab, as the server stamped them. */
export function usePeers(provider: HocuspocusProvider): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const read = () => {
      const next: Peer[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const p = readPresence(state);
        if (p) next.push({ ...p, clientId, color: peerColor(p.user.id) });
      }
      setPeers(next);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [provider]);
  return peers;
}

/** One avatar per person, even with several tabs open; editors before viewers. */
export function uniquePeople(peers: Peer[]): Peer[] {
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
export function useLocalPresence(provider: HocuspocusProvider) {
  const publisher = useMemo(() => {
    const state: LocalPresence = { cursor: null, selection: [], editing: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSent = 0;
    const flush = () => {
      lastSent = Date.now();
      provider.awareness?.setLocalState({ ...state });
    };
    return {
      flush,
      stop() {
        clearTimeout(timer);
        provider.awareness?.setLocalState(null);
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
        state.editing = editing;
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
