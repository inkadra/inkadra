// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { ClipperError } from './errors.ts';
import { createRouter, type Handlers, type Reply } from './messages.ts';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const board = { id: 'b1', projectId: 'p1', title: 'Moodboard', projectName: 'Film' };

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    status: vi.fn(async () => ({
      connected: true,
      revoked: false,
      serverUrl: 'https://ink.example',
      user: { name: 'Ada', email: 'ada@example.com' },
      lastBoard: board,
    })),
    boards: vi.fn(async () => []),
    'save-page': vi.fn(async () => ({
      board,
      boardUrl: 'https://ink.example/p/p1/b/b1',
      elementId: 'e',
    })),
    ...overrides,
  };
}

/** Calls the listener the way chrome.runtime.onMessage does and waits for the answer. */
function dispatch(
  listener: ReturnType<typeof createRouter>,
  message: unknown,
  sender: chrome.runtime.MessageSender = { id: EXT, url: `chrome-extension://${EXT}/popup.html` },
): Promise<{ async: boolean; reply: Reply<unknown> | undefined }> {
  return new Promise((resolve) => {
    let done: ((reply: Reply<unknown>) => void) | undefined;
    let early: Reply<unknown> | undefined;
    const async = listener(message, sender, (r) => {
      if (done) done(r);
      else early = r;
    });
    if (early || !async) resolve({ async, reply: early });
    else done = (reply) => resolve({ async, reply });
  });
}

describe('message router', () => {
  it('dispatches on type and answers asynchronously', async () => {
    const h = handlers();
    const listener = createRouter(h, { extensionId: EXT });
    const { async, reply } = await dispatch(listener, { type: 'boards', query: 'mood' });
    expect(async).toBe(true);
    expect(reply).toEqual({ ok: true, data: [] });
    expect(h.boards).toHaveBeenCalledWith({ type: 'boards', query: 'mood' });
    expect(h.status).not.toHaveBeenCalled();
  });

  it('passes the save request through to its handler', async () => {
    const h = handlers();
    const listener = createRouter(h, { extensionId: EXT });
    const message = { type: 'save-page', board, url: 'https://a.example/', tags: ['ref'] };
    const { reply } = await dispatch(listener, message);
    expect(h['save-page']).toHaveBeenCalledWith(message);
    expect(reply).toMatchObject({ ok: true, data: { elementId: 'e' } });
  });

  it('turns failures into serialised errors and reports them', async () => {
    const onError = vi.fn();
    const listener = createRouter(
      handlers({
        'save-page': async () => {
          throw new ClipperError('unauthorized', 'Token revoked.');
        },
      }),
      { extensionId: EXT, onError },
    );
    const { reply } = await dispatch(listener, { type: 'save-page', board, url: 'https://a/' });
    expect(reply).toEqual({
      ok: false,
      error: { kind: 'unauthorized', message: 'Token revoked.' },
    });
    expect(onError).toHaveBeenCalledWith(expect.any(ClipperError));
  });

  it('still answers when the error hook fails', async () => {
    const listener = createRouter(
      handlers({
        boards: async () => {
          throw new Error('boom');
        },
      }),
      {
        extensionId: EXT,
        onError: async () => {
          throw new Error('hook');
        },
      },
    );
    const { reply } = await dispatch(listener, { type: 'boards' });
    expect(reply).toEqual({ ok: false, error: { kind: 'server', message: 'boom' } });
  });

  it('answers unknown messages at once', async () => {
    const listener = createRouter(handlers(), { extensionId: EXT });
    for (const message of [{ type: 'nope' }, { type: 'toString' }, 'status', null]) {
      const { async, reply } = await dispatch(listener, message);
      expect(async).toBe(false);
      expect(reply).toMatchObject({ ok: false, error: { kind: 'bad_request' } });
    }
  });

  it('ignores messages from other extensions and from web pages', async () => {
    const h = handlers();
    const listener = createRouter(h, { extensionId: EXT });
    const other = await dispatch(listener, { type: 'status' }, { id: 'someone-else' });
    const page = await dispatch(listener, { type: 'status' }, { url: 'https://evil.example/' });
    expect(other).toEqual({ async: false, reply: undefined });
    expect(page).toEqual({ async: false, reply: undefined });
    expect(h.status).not.toHaveBeenCalled();
  });
});
