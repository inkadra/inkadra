import { deflateSync } from 'node:zlib';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createElement, moveIntoParent } from '@inkadra/canvas-core';
import { boardDocName, roots } from '@inkadra/doc-schema';
import WebSocket from 'ws';
import * as Y from 'yjs';

/**
 * Builds the load-test board through the public API and the collaboration WebSocket, the same
 * way the web app writes it: 1000 elements, half of them images when the server takes uploads.
 */

export const perfUser = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

export interface Seeded {
  projectId: string;
  boardId: string;
  cookie: string;
  counts: Record<string, number>;
  images: 'uploaded' | 'unavailable';
}

async function signIn(base: string): Promise<string> {
  const headers = { 'content-type': 'application/json', origin: base };
  const instance = (await (await fetch(`${base}/api/v1/instance`)).json()) as {
    setupRequired: boolean;
  };
  const path = instance.setupRequired ? 'sign-up/email' : 'sign-in/email';
  const res = await fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(perfUser),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  return cookies.join('; ');
}

/** A small solid-colour PNG, different for each seed. */
function png(seed: number, w = 96, h = 64): Buffer {
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
async function upload(base: string, cookie: string, projectId: string, i: number) {
  const body = png(i);
  const meta = (v: string) => Buffer.from(v).toString('base64');
  const create = await fetch(`${base}/api/v1/uploads`, {
    method: 'POST',
    headers: {
      cookie,
      origin: base,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(body.length),
      'Upload-Metadata': `projectId ${meta(projectId)},filename ${meta(`perf-${i}.png`)},filetype ${meta('image/png')}`,
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
    body: new Uint8Array(body),
  });
  return send.ok
    ? (send.headers.get('inkadra-asset-id') ?? create.headers.get('inkadra-asset-id'))
    : null;
}

export async function seedPerfBoard(base: string, total = 1000): Promise<Seeded> {
  const cookie = await signIn(base);
  const res = await fetch(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: `Carico ${new Date().toISOString().slice(11, 19)}` }),
  });
  const project = (await res.json()) as { id: string; rootBoardId: string };

  // 50 distinct images, reused by over 500 cards, as on a real moodboard with repeated references.
  const assets: string[] = [];
  for (let i = 0; i < 50; i++) {
    const id = await upload(base, cookie, project.id, i);
    if (!id) break;
    assets.push(id);
  }
  // Thumbnails are made in the background: wait for them, the test times a board in use.
  const deadline = Date.now() + 60_000;
  for (const id of assets) {
    for (;;) {
      const asset = (await (
        await fetch(`${base}/api/v1/assets/${id}`, { headers: { cookie } })
      ).json()) as { status: string };
      if (asset.status === 'ready' || asset.status === 'failed') break;
      if (Date.now() > deadline) throw new Error(`Asset ${id} still ${asset.status}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const doc = new Y.Doc();
  const counts: Record<string, number> = {};
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

  // Push the document through the collaboration server, as a browser would.
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie, origin: base } });
    }
  }
  const remote = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `${base.replace(/^http/, 'ws')}/collab`,
    WebSocketPolyfill: CookieSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: boardDocName(project.rootBoardId),
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

  return {
    projectId: project.id,
    boardId: project.rootBoardId,
    cookie,
    counts,
    images: assets.length > 0 ? 'uploaded' : 'unavailable',
  };
}
