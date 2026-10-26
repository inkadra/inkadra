// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reply } from './messages.ts';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const board = { id: 'b', projectId: 'p', title: 'Board', projectName: null };
const result = { boardId: board.id, elementId: 'e', assetId: null };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const event = () => ({ addListener: vi.fn() });
let chromeMock: ReturnType<typeof mockChrome>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function mockChrome() {
  return {
    runtime: {
      id: extensionId,
      onInstalled: event(),
      onMessage: event(),
      getPlatformInfo: vi.fn(async () => ({ os: 'linux', arch: 'x86-64' })),
    },
    contextMenus: { onClicked: event() },
    commands: { onCommand: event() },
    storage: {
      local: {
        setAccessLevel: vi.fn(),
        set: vi.fn(async () => {}),
        get: vi.fn(async (key: string) => ({
          [key]:
            key === 'connection'
              ? {
                  serverUrl: 'https://ink.example',
                  token: 'test-token',
                  uploadMaxBytes: 1024,
                }
              : key === 'lastBoard'
                ? board
                : [],
        })),
      },
    },
    scripting: { executeScript: vi.fn(async () => []) },
    i18n: { getMessage: vi.fn((key: string) => key) },
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  chromeMock = mockChrome();
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response(201, result));
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('fetch', fetchMock);
  await import('./background.ts');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function send(message: unknown): Promise<Reply<unknown>> {
  const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]![0];
  return new Promise((resolve) =>
    listener(
      message,
      { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` },
      resolve,
    ),
  );
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('background clip entry points', () => {
  it('routes the column request and popup title/column to the API', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { items: [{ id: 'col', title: '' }] }));
    expect(await send({ type: 'columns', boardId: 'b' })).toEqual({
      ok: true,
      data: [{ id: 'col', title: '' }],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ink.example/api/v1/boards/b/columns');
    await send({
      type: 'save-page',
      board,
      url: 'https://a.example',
      title: 'Tab title',
      columnId: 'col',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      title: 'Tab title',
      columnId: 'col',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['shortcut', 'page-menu'])('includes the tab title via %s', async (entry) => {
    const tab = { id: 1, url: 'https://a.example', title: 'Tab title' };
    if (entry === 'shortcut')
      chromeMock.commands.onCommand.addListener.mock.calls[0]![0]('save-page', tab);
    else
      chromeMock.contextMenus.onClicked.addListener.mock.calls[0]![0](
        { menuItemId: 'save-page' },
        tab,
      );
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      title: 'Tab title',
    });
  });

  it('does not label a different link with the source tab title', async () => {
    chromeMock.contextMenus.onClicked.addListener.mock.calls[0]![0](
      { menuItemId: 'save-link', linkUrl: 'https://other.example', pageUrl: 'https://a.example' },
      { id: 1, url: 'https://a.example', title: 'Source title' },
    );
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('title');
  });

  it.each([413, 429, 500])(
    'returns %i once with structured details and the instance limit',
    async (status) => {
      fetchMock.mockResolvedValue(
        response(status, { error: { code: 'internal', details: { reason: 'outcome_unknown' } } }),
      );
      // Only a 500 uses outcome_unknown in the server contract.
      if (status !== 500) fetchMock.mockResolvedValue(response(status, { error: {} }));
      const reply = await send({ type: 'save-page', board, url: 'https://a.example' });
      expect(reply).toMatchObject({
        ok: false,
        error: {
          kind: status === 413 ? 'too_large' : status === 429 ? 'rate_limited' : 'clip_unconfirmed',
          ...(status === 413 ? { uploadMaxBytes: 1024 } : {}),
          ...(status === 500 ? { reason: 'outcome_unknown' } : {}),
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([201, 500])(
    'keeps a menu image upload alive beyond 30s without a popup, then stops (%i)',
    async (status) => {
      let finish!: (response: Response) => void;
      fetchMock
        .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' })))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
      chromeMock.contextMenus.onClicked.addListener.mock.calls[0]![0](
        { menuItemId: 'save-image', srcUrl: 'https://a.example/a.png' },
        { id: 1 },
      );
      await flush();
      await vi.waitFor(() => expect(fetchMock.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData));
      await vi.advanceTimersByTimeAsync(65_000);
      expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      finish(response(status, status === 201 ? result : { error: { code: 'internal' } }));
      await flush();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps concurrent saves alive independently and cleans up network failures', async () => {
    let finish!: (response: Response) => void;
    let fail!: (error: Error) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
    const one = send({ type: 'save-page', board, url: 'https://one.example' });
    const two = send({ type: 'save-page', board, url: 'https://two.example' });
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(2);
    finish(response(201, result));
    await one;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
    fail(new TypeError('Network failure'));
    expect(await two).toMatchObject({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
