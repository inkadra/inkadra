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
const menuIds = new Set<string>();
let duplicateIds = 0;

function mockChrome() {
  return {
    runtime: {
      id: extensionId,
      onInstalled: event(),
      onStartup: event(),
      OnInstalledReason: { INSTALL: 'install' },
      onMessage: event(),
      getPlatformInfo: vi.fn(async () => ({ os: 'linux', arch: 'x86-64' })),
    },
    contextMenus: {
      onClicked: event(),
      removeAll: vi.fn(async () => {
        await Promise.resolve();
        menuIds.clear();
      }),
      create: vi.fn(({ id }: { id: string }, done: () => void) => {
        duplicateIds += menuIds.has(id) ? 1 : 0;
        menuIds.add(id);
        setTimeout(done, 1);
      }),
    },
    commands: { onCommand: event() },
    storage: {
      local: {
        onChanged: event(),
        setAccessLevel: vi.fn(),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        get: vi.fn(async (key: string) => ({
          [key]:
            key === 'connection'
              ? {
                  serverUrl: 'https://ink.example',
                  token: 'test-token',
                  uploadMaxBytes: 1024,
                }
              : key === 'recentBoards'
                ? [board]
                : [],
        })),
      },
    },
    scripting: { executeScript: vi.fn(async () => []) },
    i18n: { getMessage: vi.fn((key: string) => key) },
  };
}

beforeEach(async () => {
  menuIds.clear();
  duplicateIds = 0;
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
  it('shows cached status immediately and lists cached destinations offline', async () => {
    expect(await send({ type: 'status' })).toMatchObject({ ok: true, data: { lastBoard: board } });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await send({ type: 'boards' })).toMatchObject({
      ok: true,
      data: [{ ...board, section: 'recent' }],
    });
  });

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
    expect(
      JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body)),
    ).toMatchObject({
      title: 'Tab title',
    });
  });

  it('does not label a different link with the source tab title', async () => {
    chromeMock.contextMenus.onClicked.addListener.mock.calls[0]![0](
      { menuItemId: 'save-link', linkUrl: 'https://other.example', pageUrl: 'https://a.example' },
      { id: 1, url: 'https://a.example', title: 'Source title' },
    );
    await flush();
    expect(
      JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body)),
    ).not.toHaveProperty('title');
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
        .mockResolvedValueOnce(response(200, { items: [{ ...board, myRole: 'editor' }] }))
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
      await vi.waitFor(() =>
        expect(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body).toBeInstanceOf(
          FormData,
        ),
      );
      await vi.advanceTimersByTimeAsync(65_000);
      expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      finish(response(status, status === 201 ? result : { error: { code: 'internal' } }));
      await flush();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(chromeMock.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(3);
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

describe('save-to menus', () => {
  const other = { id: 'o', projectId: 'p', title: 'Other', projectName: null };
  const click = (info: object) =>
    chromeMock.contextMenus.onClicked.addListener.mock.calls[0]![0](info, { id: 1 });
  const storageChange = (changes: object) =>
    chromeMock.storage.local.onChanged.addListener.mock.calls[0]![0](changes);
  const stored = (connection: unknown, recentBoards: unknown) =>
    chromeMock.storage.local.get.mockImplementation((async (key: string) => ({
      [key]: key === 'connection' ? connection : key === 'recentBoards' ? recentBoards : undefined,
    })) as never);
  const connection = { serverUrl: 'https://ink.example', token: 'test-token', uploadMaxBytes: 0 };
  const clipBody = () =>
    JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body));

  it('rebuilds on install, startup and storage changes, without overlapping', async () => {
    chromeMock.runtime.onInstalled.addListener.mock.calls[0]![0]({ reason: 'update' });
    chromeMock.runtime.onStartup.addListener.mock.calls[0]![0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(menuIds).toContain('save-to-page:b');
    stored(connection, [other]);
    for (let i = 0; i < 3; i++) storageChange({ recentBoards: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(duplicateIds).toBe(0);
    expect(menuIds).toContain('save-to-page:o');
    expect(menuIds).not.toContain('save-to-page:b');
  });

  it.each([
    ['disconnected', undefined],
    ['revoked', { ...connection, token: null }],
  ])('has no save-to parent when %s', async (_state, current) => {
    stored(current, [other]);
    storageChange({ connection: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(menuIds).toContain('save-page');
    expect([...menuIds].filter((id) => id.startsWith('save-to-'))).toEqual([]);
  });

  it('ignores storage changes that do not affect the menus', async () => {
    storageChange({ lastBoard: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(chromeMock.contextMenus.removeAll).not.toHaveBeenCalled();
  });

  it('saves to the chosen board, not the last one', async () => {
    stored(connection, [board, other]);
    click({
      menuItemId: 'save-to-selection:o',
      selectionText: 'quote',
      pageUrl: 'https://a.example',
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(clipBody()).toMatchObject({ boardId: 'o', text: 'quote' });
    expect(chromeMock.scripting.executeScript.mock.calls.at(-1)).toMatchObject([
      { args: [{ tone: 'ok', text: 'toast_saved' }] },
    ]);
  });

  it('forgets a chosen board that no longer exists and reports it', async () => {
    stored(connection, [board, other]);
    fetchMock.mockImplementation(async () => response(404, { error: {} }));
    click({ menuItemId: 'save-to-link:o', linkUrl: 'https://l.example' });
    await vi.advanceTimersByTimeAsync(10);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ recentBoards: [board] });
    expect(chromeMock.scripting.executeScript.mock.calls.at(-1)).toMatchObject([
      { args: [{ tone: 'error', text: 'error_not_found' }] },
    ]);
  });

  it('reports a chosen board that left the recent list, without saving', async () => {
    stored(connection, [board]);
    click({ menuItemId: 'save-to-link:gone', linkUrl: 'https://l.example' });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeMock.scripting.executeScript.mock.calls.at(-1)).toMatchObject([
      { args: [{ tone: 'error', text: 'error_not_found' }] },
    ]);
  });
});
