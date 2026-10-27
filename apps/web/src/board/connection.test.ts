import { HocuspocusProvider, type HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSaveStore, type SaveState, watchSaves } from './connection.ts';

/**
 * The real provider on a socket we drive by hand: the socket opens and closes, and the server's
 * messages arrive as the bytes Hocuspocus sends, so the unsynced count moves exactly as it does
 * in the browser.
 */
const NAME = 'board:test';
// Message types from the Hocuspocus protocol, and the Yjs sync step the server answers with.
const SYNC = 0;
const SYNC_STEP_2 = 1;
const SYNC_STATUS = 8;

function varUint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function frame(...body: number[]): MessageEvent {
  const name = [...new TextEncoder().encode(NAME)];
  return new MessageEvent('message', {
    data: new Uint8Array([...varUint(name.length), ...name, ...body]),
  });
}

/** The server's answer to our first sync step: everything it has that we lack. */
const serverState = (doc: Y.Doc) => {
  const update = Y.encodeStateAsUpdate(doc);
  return frame(SYNC, SYNC_STEP_2, ...varUint(update.length), ...update);
};
/** The server applied a change we sent: our sync reply on connecting, or a later update. */
const applied = () => frame(SYNC_STATUS, 1);

class FakeSocket {
  private handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  sent = 0;
  on(event: string, fn: (...args: unknown[]) => unknown) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  off(event: string, fn: (...args: unknown[]) => unknown) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== fn),
    );
  }
  async emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) await fn(...args);
  }
  attach() {}
  detach() {}
  destroy() {}
  send() {
    this.sent++;
  }
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const run of cleanup) run();
  cleanup = [];
});

function setup() {
  const socket = new FakeSocket();
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    name: NAME,
    document: doc,
    websocketProvider: socket as unknown as HocuspocusProviderWebsocket,
  });
  provider.attach();
  let clock = 1_000;
  const states: SaveState[] = [];
  const stop = watchSaves(
    provider,
    (s) => states.push(s),
    () => clock,
  );
  cleanup.push(() => {
    stop();
    provider.destroy();
  });
  const last = () => states.at(-1);
  return {
    socket,
    doc,
    provider,
    states,
    last,
    tick: (ms: number) => {
      clock += ms;
    },
    /** Socket open, our token and first sync step out, the server's state and ack back. */
    async connect(server = new Y.Doc()) {
      await socket.emit('open', {});
      expect(last()?.pending).toBe(1);
      provider.onMessage(serverState(server));
      provider.onMessage(applied());
    },
  };
}

describe('saved state from the collaboration provider', () => {
  it('is not a save to connect, even when the server sends the board', async () => {
    const { connect, provider, last } = setup();
    const server = new Y.Doc();
    server.getMap('elements').set('a', 'from the server');
    await connect(server);
    expect(provider.synced).toBe(true);
    expect(provider.document.getMap('elements').get('a')).toBe('from the server');
    expect(last()).toEqual({ pending: 0, savedAt: null });
  });

  it('is not a save to reconnect without editing', async () => {
    const { connect, socket, tick, last } = setup();
    await connect();
    await socket.emit('close', { event: { code: 1006, reason: '' } });
    tick(30_000);
    await connect();
    expect(last()).toEqual({ pending: 0, savedAt: null });
  });

  it('saves a local edit once the server acknowledges it', async () => {
    const { connect, doc, provider, tick, last } = setup();
    await connect();
    tick(5_000);
    doc.getMap('elements').set('a', 'mine');
    expect(last()).toEqual({ pending: 1, savedAt: null });
    tick(200);
    provider.onMessage(applied());
    expect(last()).toEqual({ pending: 0, savedAt: 6_200 });
  });

  it('keeps the last save through a reconnection with nothing new', async () => {
    const { connect, doc, provider, socket, tick, last } = setup();
    await connect();
    doc.getMap('elements').set('a', 'mine');
    provider.onMessage(applied());
    const saved = last()?.savedAt;
    expect(saved).toBe(1_000);
    await socket.emit('close', { event: { code: 1006, reason: '' } });
    tick(60_000);
    await connect();
    expect(last()).toEqual({ pending: 0, savedAt: saved });
  });

  it('saves edits made offline when the reconnection sends them', async () => {
    const { connect, doc, socket, tick, last } = setup();
    await connect();
    await socket.emit('close', { event: { code: 1006, reason: '' } });
    doc.getMap('elements').set('a', 'offline');
    expect(last()?.pending).toBe(1);
    tick(10_000);
    await connect();
    expect(last()).toEqual({ pending: 0, savedAt: 11_000 });
  });

  it('waits for every change sent during the handshake', async () => {
    const { doc, provider, socket, last } = setup();
    await socket.emit('open', {});
    doc.getMap('elements').set('a', 'early');
    expect(last()?.pending).toBe(2);
    provider.onMessage(serverState(new Y.Doc()));
    provider.onMessage(applied());
    expect(last()).toEqual({ pending: 1, savedAt: null });
    provider.onMessage(applied());
    expect(last()).toEqual({ pending: 0, savedAt: 1_000 });
  });
});

describe('save store', () => {
  it('notifies subscribers only when pending or savedAt change', () => {
    const store = createSaveStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set({ pending: 1, savedAt: null });
    store.set({ pending: 1, savedAt: null });
    store.set({ pending: 0, savedAt: 5 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toEqual({ pending: 0, savedAt: 5 });
    stop();
    store.set({ pending: 3, savedAt: 5 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
