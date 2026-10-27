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

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('window', { location: { href: 'https://inkadra.test/p/1/b/2', reload } });
  vi.stubGlobal('navigator', {
    clipboard: { writeText },
    userAgent: 'vitest-agent',
  });
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

describe('ErrorPage', () => {
  it('shows a calm message with an error ID instead of the framework default', async () => {
    await renderError();
    expect(host.textContent).toContain('appError.title');
    expect(host.textContent).toContain('appError.body');
    expect(host.textContent).toMatch(/appError\.id:[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('retry reloads the page and copy hands over the details', async () => {
    await renderError();
    const [retry, copy] = host.querySelectorAll('button');
    await act(async () => retry?.click());
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledOnce();
    const details = JSON.parse(writeText.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(details.message).toBe('render exploded');
    expect(details.page).toBe('https://inkadra.test/p/1/b/2');
    expect(details.errorId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(host.textContent).toContain('appError.copied');
  });
});
