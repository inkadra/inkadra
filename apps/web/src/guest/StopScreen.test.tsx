// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StopScreen } from './StopScreen.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;
const reload = vi.fn();
const writeText = vi.fn();

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('window', { location: { href: 'https://inkadra.test/s/token-1', reload } });
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  writeText.mockClear();
  reload.mockClear();
  await act(async () => root.unmount());
  host.remove();
});

describe('StopScreen', () => {
  it('offers "ask for a new link" on an expired link and copies it without a backend', async () => {
    await act(async () => root.render(<StopScreen stop="expired" />));
    expect(host.textContent).toContain('guest.stop.expired.title');
    expect(host.textContent).toContain('guest.stop.expired.body');
    const [ask] = host.querySelectorAll('button');
    await act(async () => ask?.click());
    expect(writeText).toHaveBeenCalledWith('https://inkadra.test/s/token-1');
    expect(host.textContent).toContain('guest.askLink.copied');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('guest.askLink.hint');
  });

  it('offers a new link for every dead-link stop and not for retryable ones', async () => {
    for (const stop of ['not_found', 'expired', 'revoked', 'unavailable'] as const) {
      await act(async () => root.render(<StopScreen key={stop} stop={stop} />));
      expect(host.textContent).toContain('guest.askLink.button');
      await act(async () => root.render(<StopScreen key={`${stop}2`} stop="error" />));
      expect(host.textContent).not.toContain('guest.askLink.button');
      expect(host.textContent).toContain('guest.retry');
    }
  });

  it('retry reloads on a temporary error', async () => {
    await act(async () => root.render(<StopScreen stop="error" />));
    const [retry] = host.querySelectorAll('button');
    await act(async () => retry?.click());
    expect(reload).toHaveBeenCalledOnce();
  });
});
