// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorPage } from './ErrorPage.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${params.id as string}` : key,
  }),
}));

function Boom(): ReactNode {
  throw new Error('render exploded');
}

let host: HTMLDivElement;
let root: Root;
const reload = vi.fn();
const writeText = vi.fn();

function stubHost(href: string) {
  vi.stubGlobal('window', { location: { href, reload } });
  vi.stubGlobal('navigator', {
    clipboard: { writeText },
    userAgent: 'vitest-agent',
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  stubHost('https://inkadra.test/p/1/b/2');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  writeText.mockClear();
  await act(async () => root.unmount());
  host.remove();
});

async function renderError() {
  const router = createMemoryRouter(
    [{ path: '/', element: <Boom />, errorElement: <ErrorPage /> }],
    { initialEntries: ['/'] },
  );
  await act(async () => root.render(<RouterProvider router={router} />));
}

function copiedDetails(index: number): Record<string, unknown> {
  return JSON.parse(writeText.mock.calls[index]?.[0] as string) as Record<string, unknown>;
}

describe('ErrorPage', () => {
  it('shows a calm message with an error ID instead of the framework default', async () => {
    await renderError();
    expect(host.querySelector('h1')?.textContent).toBe('appError.title');
    expect(host.textContent).toContain('appError.body');
    expect(host.textContent).toMatch(/appError\.id:[0-9a-f]{4}-[0-9a-f]{4}/);
    // The alert names the error alone: retry and copy stay outside it.
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('appError.body');
    expect(alert?.querySelectorAll('button')).toHaveLength(0);
  });

  it('logs the error once with its on-screen error ID', async () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderError();
      const shownId = /appError\.id:([0-9a-f]{4}-[0-9a-f]{4})/.exec(
        host.querySelector('.app-error__id')?.textContent ?? '',
      )?.[1];
      expect(shownId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
      const logCall = onError.mock.calls.find((call) =>
        (call[0] as string).startsWith('App error'),
      );
      expect(logCall?.[0]).toBe(`App error ${shownId}`);
      expect(logCall?.[1]).toBeInstanceOf(Error);
    } finally {
      onError.mockRestore();
    }
  });

  it('retry reloads the page and copy hands over the details', async () => {
    await renderError();
    const [retry, copy] = host.querySelectorAll('button');
    await act(async () => retry?.click());
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledOnce();
    const details = copiedDetails(0);
    expect(details.message).toBe('render exploded');
    expect(details.page).toBe('https://inkadra.test/p/1/b/2');
    expect(details.errorId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(host.textContent).toContain('appError.copied');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('appError.copied');
  });

  it('keeps the error ID stable across two copies', async () => {
    await renderError();
    const [retry, copy] = host.querySelectorAll('button');
    await act(async () => copy?.click());
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(copiedDetails(0).errorId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(copiedDetails(0).errorId).toBe(copiedDetails(1).errorId);
    expect(retry).toBeTruthy();
  });

  it('redacts share and invitation tokens from the copied page reference', async () => {
    stubHost('https://inkadra.test/s/super-secret-token?next=/join/invited-token#leaky-hash');
    await renderError();
    const [retry, copy] = host.querySelectorAll('button');
    await act(async () => copy?.click());
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('invited-token');
    expect(text).not.toContain('leaky-hash');
    const details = JSON.parse(text) as Record<string, unknown>;
    expect(details.page).toBe('https://inkadra.test/s/[redacted]');
    expect(retry).toBeTruthy();
  });
});
