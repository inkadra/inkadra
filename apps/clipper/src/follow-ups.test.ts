// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../public/_locales/en/messages.json';
import itMessages from '../public/_locales/it/messages.json';
import { InkadraApi } from './api.ts';
import { searchBoards } from './boards.ts';
import { saveClip } from './clip.ts';
import { ClipperError } from './errors.ts';
import { errorText, formatBytes } from './i18n.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const result = { boardId, elementId: 'e1', assetId: null };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function client(fetch: typeof globalThis.fetch) {
  return new InkadraApi({ baseUrl: 'https://ink.example', token: 'test-token', fetch });
}

afterEach(() => vi.unstubAllGlobals());

it('sends a trimmed tab title within the contract limit', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => response(201, result));
  await saveClip(
    { api: client(fetch), imageFetchers: [], uploadMaxBytes: 0 },
    { boardId },
    { kind: 'link', url: 'https://a.example', title: `  ${'t'.repeat(600)}  ` },
  );
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).title).toBe('t'.repeat(500));
});

it('filters both board and element search hits by role while keeping legacy hits', async () => {
  const items = ['owner', 'editor', 'viewer', 'commenter', undefined].flatMap((myRole, index) =>
    ['board', 'element'].map((kind) => ({
      kind,
      boardId: `${index}-${kind}`,
      projectId: 'p',
      projectName: 'Project',
      boardTitle: 'Board',
      myRole,
    })),
  );
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(200, { items }));
  expect((await searchBoards(client(fetch), 'board')).map((b) => b.id)).toEqual([
    '0-board',
    '1-board',
    '4-board',
    '0-element',
    '1-element',
    '4-element',
  ]);
});

describe('clip errors', () => {
  it('keeps a 500 uncertain even with a misleading error code or a non-JSON proxy body', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(500, { error: { code: 'payload_too_large' } }))
      .mockResolvedValueOnce(new Response('<html>Proxy error</html>', { status: 500 }));
    for (let i = 0; i < 2; i++)
      await expect(client(fetch).clip({ boardId, text: 'x' })).rejects.toMatchObject({
        kind: 'clip_unconfirmed',
      });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    null,
    'bad',
    { reason: 42 },
    { reason: 'new_reason' },
    { reason: 'outcome_unknown' },
  ])('keeps every 500 uncertain without retrying, details=%j', async (details) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        response(500, { error: { code: 'internal', message: 'Unconfirmed', details } }),
      );
    const api = client(fetch);
    for (const send of [
      () => api.clip({ boardId, text: 'x' }),
      () => api.clipFile({ boardId }, new Blob(['x']), 'x.txt'),
    ]) {
      await expect(send()).rejects.toMatchObject({ kind: 'clip_unconfirmed', status: 500 });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reads details.reason and preserves it on uncertain errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(500, {
        error: { code: 'internal', details: { reason: 'outcome_unknown' } },
      }),
    );
    await expect(client(fetch).clip({ boardId, text: 'x' })).rejects.toMatchObject({
      kind: 'clip_unconfirmed',
      reason: 'outcome_unknown',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([en, itMessages])('localizes uncertain outcomes, limits and rate limits', (messages) => {
    vi.stubGlobal('chrome', {
      i18n: {
        getMessage: (key: keyof typeof en, value?: string) =>
          messages[key].message.replace('$LIMIT$', value ?? ''),
      },
    });
    expect(errorText(new ClipperError('clip_unconfirmed'))).toBe(
      messages.error_clip_unconfirmed.message,
    );
    expect(errorText(new ClipperError('rate_limited'))).toBe(messages.error_rate_limited.message);
    expect(errorText(new ClipperError('too_large', undefined, { uploadMaxBytes: 1024 }))).toContain(
      '1 KB',
    );
    expect(formatBytes(52_428_800)).toBe('50 MB');
    expect(formatBytes(500)).toBe('500 B');
    for (const uploadMaxBytes of [0, undefined]) {
      expect(errorText(new ClipperError('too_large', undefined, { uploadMaxBytes }))).toBe(
        messages.error_too_large.message,
      );
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(itMessages).sort());
  });
});
