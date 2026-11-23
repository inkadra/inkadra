import { deflateSync } from 'node:zlib';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
import { addStroke, createElement, moveIntoParent } from '@inkadra/canvas-core';
import { boardDocName, CURRENT_SCHEMA_VERSION, roots } from '@inkadra/doc-schema';
import WebSocket from 'ws';
import * as Y from 'yjs';

/**
 * Builds the load-test board through the public API and the collaboration WebSocket, the same
 * way the web app writes it: 1000 elements, half of them images when the server takes uploads.
 */

export interface Account {
  name: string;
  email: string;
  password: string;
}

export const perfUser: Account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

export interface SeedOptions {
  total?: number;
  account?: Account;
  /** Name of the project whose root board is filled. */
  name?: string;
  /** Storyboard frames with a drawing, and the range of their stroke counts. */
  drawnFrames?: number;
  strokesPerFrame?: [number, number];
}

export interface Seeded {
  projectId: string;
  boardId: string;
  cookie: string;
  counts: Record<string, number>;
  images: 'uploaded' | 'unavailable';
  /** Strokes drawn on the frames. */
  strokes: number;
}

/**
 * Signs in. Creates the account only on an instance without users (its first-run setup),
 * never on one that already has them.
 */
export async function signIn(base: string, account: Account): Promise<string> {
  const headers = { 'content-type': 'application/json', origin: base };
  const info = await fetch(`${base}/api/v1/instance`);
  if (!info.ok) throw new Error(`${base} does not answer as an Inkadra instance (${info.status})`);
  const instance = (await info.json()) as { setupRequired: boolean };
  const path = instance.setupRequired ? 'sign-up/email' : 'sign-in/email';
  const res = await fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      instance.setupRequired ? account : { email: account.email, password: account.password },
    ),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  return cookies.join('; ');
}

/** A small solid-colour PNG, different for each seed. */
export function png(seed: number, w = 96, h = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const r = (seed * 67) % 256;
  const g = (seed * 131) % 256;
  const b = (seed * 29) % 256;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) rows.set([(r + x) % 256, (g + y) % 256, b], o + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Single-request tus upload. Returns the asset id, or null when uploads are not available. */
export async function uploadFile(
  base: string,
  cookie: string,
  projectId: string,
  file: { body: Buffer; name: string; type: string },
): Promise<string | null> {
  const meta = (v: string) => Buffer.from(v).toString('base64');
  const create = await fetch(`${base}/api/v1/uploads`, {
    method: 'POST',
    headers: {
      cookie,
      origin: base,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.body.length),
      'Upload-Metadata': `projectId ${meta(projectId)},filename ${meta(file.name)},filetype ${meta(file.type)}`,
    },
  });
  const location = create.headers.get('location');
  if (!create.ok || !location) return null;
  const send = await fetch(new URL(location, base), {
    method: 'PATCH',
    headers: {
      cookie,
      origin: base,
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body: new Uint8Array(file.body),
  });
  return send.ok
    ? (send.headers.get('inkadra-asset-id') ?? create.headers.get('inkadra-asset-id'))
    : null;
}

/** Waits until the background jobs have made the thumbnails of these assets. */
export async function waitForAssets(base: string, cookie: string, ids: string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (const id of ids) {
    for (;;) {
      const asset = (await (
        await fetch(`${base}/api/v1/assets/${id}`, { headers: { cookie } })
      ).json()) as { status: string };
      if (asset.status === 'ready' || asset.status === 'failed') break;
      if (Date.now() > deadline) throw new Error(`Asset ${id} still ${asset.status}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/** Sends a locally built board document through the collaboration server, as a browser would. */
export async function pushBoardDoc(
  base: string,
  cookie: string,
  boardId: string,
  doc: Y.Doc,
  supportedSchemaVersion = CURRENT_SCHEMA_VERSION,
): Promise<void> {
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: base } });
    }
  }
  const remote = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `${base.replace(/^http/, 'ws')}/collab?schemaVersion=${supportedSchemaVersion}`,
    WebSocketPolyfill: CookieSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: boardDocName(boardId),
    document: remote,
  });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Collab sync timed out')), 20_000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Collab upload timed out')), 20_000);
    const check = () => {
      if (!provider.hasUnsyncedChanges) {
        clearTimeout(timer);
        resolve();
      } else setTimeout(check, 100);
    };
    check();
  });
  provider.destroy();
  websocketProvider.destroy();
}

export async function seedPerfBoard(base: string, options: SeedOptions = {}): Promise<Seeded> {
  const {
    total = 1000,
    account = perfUser,
    drawnFrames = 0,
    strokesPerFrame = [300, 600],
  } = options;
  const name = options.name ?? `Carico ${new Date().toISOString().slice(11, 19)}`;
  const cookie = await signIn(base, account);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Project creation failed: ${res.status} ${await res.text()}`);
  const project = (await res.json()) as { id: string; rootBoardId: string };

  // 50 distinct images, reused by over 500 cards, as on a real moodboard with repeated references.
  const assets: string[] = [];
  for (let i = 0; i < 50; i++) {
    const file = { body: png(i), name: `perf-${i}.png`, type: 'image/png' };
    const id = await uploadFile(base, cookie, project.id, file);
    if (!id) break;
    assets.push(id);
  }
  // Thumbnails are made in the background: wait for them, the test times a board in use.
  await waitForAssets(base, cookie, assets);

  const doc = new Y.Doc();
  const counts: Record<string, number> = {};
  let strokes = 0;
  // Same board every run: a seeded generator (mulberry32) for the drawings.
  const random = seeded(1);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const opts = { userId: null };
  const cols = 40;
  doc.transact(() => {
    let placed = 0;
    let slot = 0;
    const next = () => {
      const s = slot++;
      return { x: (s % cols) * 280, y: Math.floor(s / cols) * 260 };
    };
    const count = (type: string, n = 1) => {
      counts[type] = (counts[type] ?? 0) + n;
      placed += n;
    };
    const note = (at: { x: number; y: number }, text: string) => {
      const el = createElement(doc, 'note', at, {}, opts);
      const body = roots(doc).elements.get(el.id)?.get('body') as Y.XmlFragment;
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText(text)]);
      body.insert(0, [p]);
      count('note');
      return el.id;
    };
    // A first band of columns, five notes each; they are tall, so they take two rows.
    for (let c = 0; c < 20; c++) {
      const col = createElement(doc, 'column', next(), { title: `Colonna ${c + 1}` }, opts);
      count('column');
      const kids: string[] = [];
      for (let k = 0; k < 5; k++) kids.push(note({ x: 0, y: 0 }, `Scena ${c * 5 + k + 1}`));
      moveIntoParent(doc, kids, col.id, 0);
    }
    slot = cols * 2;
    // A storyboard: frames drawn with several hundred pencil strokes each, as a film's are.
    for (let f = 0; f < drawnFrames; f++) {
      const frame = createElement(doc, 'frame', next(), { action: `Inquadratura ${f + 1}` }, opts);
      count('frame');
      const n = int(strokesPerFrame[0], strokesPerFrame[1]);
      for (let k = 0; k < n; k++) {
        const points: number[] = [];
        let x = int(0, 4096);
        let y = int(0, 4096);
        for (let p = int(8, 60); p > 0; p--) {
          x = Math.max(0, Math.min(4096, x + int(-80, 80)));
          y = Math.max(0, Math.min(4096, y + int(-80, 80)));
          points.push(x, y);
        }
        addStroke(doc, frame.id, { tool: 'pencil', color: '#1F2328', width: int(1, 12), points });
      }
      strokes += n;
    }
    for (let i = 0; placed < total; i++) {
      const at = next();
      const kind = i % 10;
      if (kind < 6) {
        const assetId = assets[i % Math.max(assets.length, 1)];
        if (assetId) {
          createElement(doc, 'image', at, { assetId }, opts);
          count('image');
        } else {
          createElement(doc, 'color', at, { hex: '#808086', label: `Colore ${i}` }, opts);
          count('color');
        }
      } else if (kind < 9) {
        note(at, `Nota ${i}: sopralluogo, luce e casting della scena ${i % 30}.`);
      } else if (i % 20 === 9) {
        createElement(
          doc,
          'todo',
          at,
          {
            title: `Lista ${i}`,
            items: [
              { id: `perfitem${i}a`, text: 'Permessi', done: true },
              { id: `perfitem${i}b`, text: 'Noleggio', done: false },
            ],
          },
          opts,
        );
        count('todo');
      } else {
        createElement(
          doc,
          'link',
          at,
          { url: `https://example.com/ref/${i}`, title: `Riferimento ${i}` },
          opts,
        );
        count('link');
      }
    }
  });

  await pushBoardDoc(base, cookie, project.rootBoardId, doc);

  return {
    projectId: project.id,
    boardId: project.rootBoardId,
    cookie,
    counts,
    images: assets.length > 0 ? 'uploaded' : 'unavailable',
    strokes,
  };
}

/**
 * Other people on the board: each a connection of its own through the collaboration server,
 * moving its cursor every 50 ms (the most the web app sends) over the seeded area. They are
 * the account's other tabs, which the board shows as peers like anyone else's.
 */
export async function startPeers(base: string, cookie: string, boardId: string, count: number) {
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: base } });
      // Closing a socket still connecting emits `error`, maybe after the provider dropped its
      // listener: without one it would throw out of the process (as in the load test's).
      this.on('error', () => {});
    }
  }
  // Every resource is registered as soon as it exists, so a peer that fails to sync takes the
  // whole group down with it: no interval, socket or document is left behind, and the others
  // stop waiting for their sync.
  const cleanups: Array<() => void> = [];
  const rollback = new AbortController();
  const stop = () => {
    rollback.abort();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
  // Per peer: cursor moves published while connected and synced, connections lost, and whether
  // it is connected and synced now.
  const moves = Array.from({ length: count }, () => 0);
  const drops = Array.from({ length: count }, () => 0);
  const live: Array<() => boolean> = Array.from({ length: count }, () => () => false);
  try {
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const document = new Y.Doc();
        cleanups.push(() => document.destroy());
        const websocketProvider = new HocuspocusProviderWebsocket({
          url: `${base.replace(/^http/, 'ws')}/collab?schemaVersion=${CURRENT_SCHEMA_VERSION}`,
          WebSocketPolyfill: CookieSocket,
        });
        cleanups.push(() => websocketProvider.destroy());
        const provider = new HocuspocusProvider({
          websocketProvider,
          name: boardDocName(boardId),
          document,
        });
        cleanups.push(() => provider.destroy());
        provider.on('close', () => {
          drops[i] = (drops[i] ?? 0) + 1;
        });
        live[i] = () => provider.synced && websocketProvider.status === WebSocketStatus.Connected;
        provider.attach();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Peer sync timed out')), 20_000);
            rollback.signal.addEventListener('abort', () => reject(new Error('Peers rolled back')));
            provider.on('synced', () => resolve());
          });
        } finally {
          clearTimeout(timeout);
        }
        if (rollback.signal.aborted) return;
        // Same path every run: a seeded walk over the seeded area.
        const random = seeded(i + 1);
        const at = { x: 1500 + i * 3000, y: 1500 };
        const timer = setInterval(() => {
          at.x = Math.max(0, Math.min(11_000, at.x + (random() - 0.5) * 120));
          at.y = Math.max(0, Math.min(7_000, at.y + (random() - 0.5) * 90));
          provider.awareness?.setLocalState({ cursor: { ...at }, selection: [], editing: null });
          // A move made without a connection reaches nobody: it does not count.
          if (live[i]?.()) moves[i] = (moves[i] ?? 0) + 1;
        }, 50);
        cleanups.push(() => clearInterval(timer));
      }),
    );
  } catch (err) {
    stop();
    throw err;
  }
  return {
    /** Each peer's cursor moves sent while connected, its lost connections, and its state now. */
    state: () =>
      moves.map((n, i) => ({ moves: n, drops: drops[i] ?? 0, live: live[i]?.() ?? false })),
    stop,
  };
}

/** mulberry32: the same seed, the same numbers. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
