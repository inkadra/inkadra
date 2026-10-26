// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { InkadraApi } from './api.ts';
import { saveClip } from './clip.ts';
import { ColumnPicker } from './columns.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const result = { boardId, elementId: 'e1', assetId: null };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function client(fetch: typeof globalThis.fetch) {
  return new InkadraApi({ baseUrl: 'https://ink.example', token: 'test-token', fetch });
}

describe('columns', () => {
  it('loads the selected board columns and sends the chosen id with JSON and multipart clips', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(200, { items: [{ id: 'col', title: 'References' }] }))
      .mockImplementation(async () => response(201, result));
    const api = client(fetch);
    expect(await api.columns('board/a')).toEqual([{ id: 'col', title: 'References' }]);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://ink.example/api/v1/boards/board%2Fa/columns');
    const deps = { api, imageFetchers: [], uploadMaxBytes: 0 };
    await saveClip(deps, { boardId, columnId: 'col' }, { kind: 'link', url: 'https://a.example' });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).columnId).toBe('col');
    await saveClip(
      { ...deps, imageFetchers: [async () => new Blob(['image'])] },
      { boardId, columnId: 'col' },
      { kind: 'image', srcUrl: 'https://a.example/a.png' },
    );
    const form = fetch.mock.calls[2]?.[1]?.body as FormData;
    expect([...form.keys()]).toEqual(['boardId', 'columnId', 'file']);
    expect(form.get('columnId')).toBe('col');
  });

  it.each([200, 404, 405, 501])(
    'keeps unsorted for an empty or unsupported endpoint (%i)',
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response(status, { items: [] }));
      const api = client(fetch);
      const picker = new ColumnPicker(
        () => {},
        (id) => api.columns(id),
      );
      await picker.select(boardId);
      expect(picker.items).toEqual([]);
      expect(picker.loading).toBe(false);
      fetch.mockResolvedValue(response(201, result));
      await saveClip(
        { api, imageFetchers: [], uploadMaxBytes: 0 },
        { boardId },
        { kind: 'link', url: 'https://a.example' },
      );
      expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).not.toHaveProperty('columnId');
    },
  );

  it.each([401, 403, 500])(
    'does not swallow errors other than unsupported (%i)',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(status, {}));
      await expect(client(fetch).columns(boardId)).rejects.toMatchObject({ status });
    },
  );

  it('resets columns immediately and ignores a late answer for a previously selected board', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(response(200, { items: [{ id: 'new', title: '' }] }))
      .mockResolvedValueOnce(response(200, { items: [] }));
    const api = client(fetch);
    const picker = new ColumnPicker(
      () => {},
      (id) => api.columns(id),
    );
    const first = picker.select('first');
    expect(picker.loading).toBe(true);
    await picker.select('second');
    finish(response(200, { items: [{ id: 'old', title: 'Old' }] }));
    await first;
    expect(picker.items).toEqual([{ id: 'new', title: '' }]);
    const third = picker.select('third');
    expect(picker.items).toEqual([]);
    await third;
    expect(picker.loading).toBe(false);
  });
});
