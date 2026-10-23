import { HocuspocusProvider } from '@hocuspocus/provider';
import { boardDocName } from '@inkadra/doc-schema';
import { COLLAB_PATH } from '@inkadra/shared/constants';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { BoardStore } from './store.ts';

export type ConnectionStatus = 'connecting' | 'synced' | 'offline' | 'denied';

export interface BoardConnection {
  store: BoardStore;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  readOnly: boolean;
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
    };
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: boardDocName(boardId),
      document: doc,
      onSynced: () => update({ status: 'synced' }),
      onDisconnect: () => update({ status: 'offline' }),
      onAuthenticated: ({ scope }) => update({ readOnly: scope === 'readonly' }),
      onAuthenticationFailed: () => update({ status: 'denied' }),
    });
    function update(patch: Partial<typeof state>) {
      state = { ...state, ...patch };
      setConn({ store, provider, ...state });
    }
    update({});
    return () => {
      provider.destroy();
      store.destroy();
      doc.destroy();
      setConn(null);
    };
  }, [boardId]);

  return conn;
}
