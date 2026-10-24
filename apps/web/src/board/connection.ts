import { HocuspocusProvider } from '@hocuspocus/provider';
import { boardDocName, readBoardNotice } from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared/constants';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { setBusy } from '../pwa/busy.ts';
import { BoardStore } from './store.ts';

/**
 * `denied`: no access to this board (refused, or removed while open). `signedOut`: the
 * session or token ended while the board was open.
 */
export type ConnectionStatus = 'connecting' | 'synced' | 'offline' | 'denied' | 'signedOut';

/** Reasons the collab server gives when it closes a board (decision 0011). */
const CLOSE_REASONS: Record<string, ConnectionStatus> = {
  Unauthorized: 'signedOut',
  Forbidden: 'denied',
};

export interface BoardConnection {
  store: BoardStore;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  readOnly: boolean;
  /** When the server last changed our access while the board was open. */
  accessChangedAt: number | null;
}

function collabUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${COLLAB_PATH}`;
}

/** Opens the board document over the collaboration WebSocket; the session cookie signs in. */
export function useBoardConnection(boardId: string): BoardConnection | null {
  const [conn, setConn] = useState<BoardConnection | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    let state: Omit<BoardConnection, 'store' | 'provider'> = {
      status: 'connecting',
      readOnly: false,
      accessChangedAt: null,
    };
    // Changes the server has not confirmed yet: a reload for a new version waits for them.
    const busy = {};
    let unsynced = 0;
    const hold = () =>
      setBusy(busy, unsynced > 0 || state.status === 'connecting' || state.status === 'offline');
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: boardDocName(boardId),
      document: doc,
      onSynced: () => update({ status: 'synced' }),
      onUnsyncedChanges: ({ number }) => {
        unsynced = number;
        hold();
      },
      onDisconnect: () => {
        if (state.status !== 'denied' && state.status !== 'signedOut')
          update({ status: 'offline' });
      },
      // The server says when the role changes between editing and reading (decision 0011).
      onStateless: ({ payload }) => {
        const msg = readBoardNotice(payload);
        if (msg?.type === 'access') update({ readOnly: msg.readOnly, accessChangedAt: Date.now() });
      },
      onClose: ({ event }) => {
        const status = CLOSE_REASONS[event.reason];
        if (status) update({ status });
      },
      onAuthenticated: ({ scope }) => update({ readOnly: scope === 'readonly' }),
      onAuthenticationFailed: () => update({ status: 'denied' }),
    });
    function update(patch: Partial<typeof state>) {
      state = { ...state, ...patch };
      hold();
      setConn({ store, provider, ...state });
    }
    update({});
    return () => {
      setBusy(busy, false);
      provider.destroy();
      store.destroy();
      doc.destroy();
      setConn(null);
    };
  }, [boardId]);

  return conn;
}
