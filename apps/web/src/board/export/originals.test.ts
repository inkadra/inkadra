// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import type { Element } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardSource } from './board-model.ts';
import { downloadOriginals, type OriginalFile, planOriginals, zipNames } from './originals.ts';

const assets = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./images.ts', async (original) => ({
  ...(await original<typeof import('./images.ts')>()),
  assetMeta: async (id: string) => assets.get(id) ?? null,
}));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Bytes that a re-encoding or a text decoder would not leave alone. */
const raw = (seed: number, length: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

function file(id: string, bytes: Uint8Array, name = `${id}.cr3`): OriginalFile {
  return {
    assetId: id,
    name,
    size: bytes.length,
    url: `/api/v1/assets/${id}/file?download=1`,
    width: null,
    height: null,
  };
}

/** Files of a stored ZIP, with their bytes. */
function unzip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    out.set(name, zip.subarray(data, data + size));
    at += 46 + nameLength;
  }
  return out;
}

describe('downloading original files', () => {
  const clicks: { href: string; download: string }[] = [];
  const saved: Blob[] = [];
  const responses = new Map<string, () => Response | Promise<Response>>();
  const fetched: { url: string; method: string }[] = [];

  beforeEach(() => {
    clicks.length = 0;
    saved.length = 0;
    responses.clear();
    fetched.length = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      fetched.push({ url, method: init.method ?? 'GET' });
      const respond = responses.get(url);
      return respond ? respond() : new Response(null, { status: 404 });
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      saved.push(blob as Blob);
      return 'blob:zip';
    };
    URL.revokeObjectURL = () => {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands one file to the browser, under its own name and the download route', async () => {
    const bytes = raw(1, 64);
    const one = file('a', bytes, 'Rim light.CR3');
    responses.set(one.url, () => new Response(null, { status: 200 }));
    expect(await downloadOriginals([one], 'Harbour')).toEqual([]);
    expect(fetched).toEqual([{ url: one.url, method: 'HEAD' }]);
    expect(clicks).toEqual([{ href: one.url, download: 'Rim light.CR3' }]);
    expect(one.url).toContain('download=1');
  });

  it('downloads nothing when the server refuses the one file, and names it', async () => {
    const one = file('a', raw(1, 64));
    responses.set(one.url, () => new Response(null, { status: 403 }));
    expect(await downloadOriginals([one], 'Harbour')).toEqual(['a.cr3']);
    expect(clicks).toEqual([]);
  });

  it('zips several files with the very bytes of the upload', async () => {
    const big = raw(2, 20 * 1024 * 1024);
    const small = raw(3, 4096);
    const first = file('a', big);
    const second = file('b', small);
    responses.set(first.url, () => new Response(big));
    responses.set(second.url, () => new Response(small));
    const progress: number[] = [];
    const failed = await downloadOriginals([first, second], 'Harbour', {
      onProgress: (p) => progress.push(p.done / p.total),
    });
    expect(failed).toEqual([]);
    expect(clicks).toEqual([{ href: 'blob:zip', download: 'Harbour.zip' }]);
    const inZip = unzip(new Uint8Array(await (saved[0] as Blob).arrayBuffer()));
    expect(sha(inZip.get('a.cr3') as Uint8Array)).toBe(sha(big));
    expect(sha(inZip.get('b.cr3') as Uint8Array)).toBe(sha(small));
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('keeps the files it got and names the refused and the truncated ones', async () => {
    const good = raw(4, 128);
    const [a, b, c] = [file('a', good), file('b', good), file('c', good)];
    responses.set(a.url, () => new Response(good));
    responses.set(b.url, () => new Response(null, { status: 403 }));
    responses.set(c.url, () => new Response(good.subarray(0, 10)));
    expect(await downloadOriginals([a, b, c], 'Harbour')).toEqual(['b.cr3', 'c.cr3']);
    const inZip = unzip(new Uint8Array(await (saved[0] as Blob).arrayBuffer()));
    expect([...inZip.keys()]).toEqual(['a.cr3']);
  });

  it('saves no ZIP when every file failed', async () => {
    const [a, b] = [file('a', raw(5, 8)), file('b', raw(6, 8))];
    expect(await downloadOriginals([a, b], 'Harbour')).toEqual(['a.cr3', 'b.cr3']);
    expect(saved).toEqual([]);
  });

  it('stops at once when the dialog is closed', async () => {
    const controller = new AbortController();
    const [a, b] = [file('a', raw(5, 8)), file('b', raw(6, 8))];
    responses.set(a.url, () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      downloadOriginals([a, b], 'Harbour', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetched).toHaveLength(1);
    expect(saved).toEqual([]);
  });
});

describe('zip names', () => {
  it('keeps every file, whatever its name', () => {
    expect(zipNames(['a.jpg', 'A.JPG', 'a.jpg', 'b'])).toEqual([
      'a.jpg',
      'A (2).JPG',
      'a (3).jpg',
      'b',
    ]);
  });

  it('cannot leave the folder it is unpacked in', () => {
    expect(zipNames(['../../etc/passwd', 'c:\\x.png', '..', '   '])).toEqual([
      '.._.._etc_passwd',
      'c__x.png',
      'file',
      'file (2)',
    ]);
  });
});

describe('which files a selection has', () => {
  const asset = (id: string, status = 'ready') =>
    ({
      id,
      filename: `${id}.cr3`,
      size: 100,
      url: `/api/v1/assets/${id}/file`,
      width: 6000,
      height: 4000,
      status,
    }) as Asset;
  const card = (id: string, type: string, extra: object = {}) =>
    ({ id, type, parent: null, x: 0, y: 0, w: 100, h: 100, ...extra }) as unknown as Element;
  const source = (...elements: Element[]) =>
    ({
      byId: new Map(elements.map((el) => [el.id, el])),
      canvas: elements.filter((el) => el.parent === null).map((el) => el.id),
      columns: new Map(),
      heightOf: () => 100,
    }) as unknown as BoardSource;
  const team = { audience: 'team', hideGuestHidden: false } as const;
  const client = { audience: 'client', hideGuestHidden: true } as const;

  beforeEach(() => {
    assets.clear();
    for (const id of ['x', 'y']) assets.set(id, asset(id));
    assets.set('late', asset('late', 'pending'));
  });

  it('counts the cards that have no file, and each file once', async () => {
    const board = source(
      card('a', 'image', { assetId: 'x' }),
      card('b', 'frame', { assetId: 'y', strokes: [], shapes: [] }),
      card('c', 'image', { assetId: 'x' }),
      card('d', 'note'),
      card('e', 'file', { assetId: 'late' }),
    );
    const plan = await planOriginals(board, new Set(['a', 'b', 'c', 'd', 'e']), team);
    expect(plan.files.map((f) => f.assetId)).toEqual(['x', 'y']);
    expect(plan.files[0]).toMatchObject({ name: 'x.cr3', size: 100, width: 6000 });
    expect(plan.files[0]?.url).toBe('/api/v1/assets/x/file?download=1');
    expect(plan.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(plan.noFile).toBe(2);
  });

  it('leaves out cards hidden from guests for clients, and only for them', async () => {
    const board = source(
      card('a', 'image', { assetId: 'x' }),
      card('b', 'image', { assetId: 'y', hiddenFromGuests: true }),
    );
    const ids = new Set(['a', 'b']);
    const forClient = await planOriginals(board, ids, client);
    expect(forClient.files.map((f) => f.assetId)).toEqual(['x']);
    expect(forClient.noFile).toBe(0);
    const forTeam = await planOriginals(board, ids, team);
    expect(forTeam.files.map((f) => f.assetId)).toEqual(['x', 'y']);
  });
});
