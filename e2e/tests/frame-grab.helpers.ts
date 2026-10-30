import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { boardDocName } from '@inkadra/doc-schema';
import WebSocket from 'ws';
import * as Y from 'yjs';

export async function readBoard(base: string, cookie: string, boardId: string): Promise<Y.Doc> {
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: base } });
    }
  }
  const doc = new Y.Doc();
  const websocket = new HocuspocusProviderWebsocket({
    url: `${base.replace(/^http/, 'ws')}/collab`,
    WebSocketPolyfill: CookieSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: websocket,
    name: boardDocName(boardId),
    document: doc,
  });
  provider.attach();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('sync timed out')), 15000);
      provider.on('synced', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return doc;
  } finally {
    provider.destroy();
    websocket.destroy();
  }
}
