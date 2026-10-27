// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeniedState } from './DeniedState.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn();

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('window', { location: { href: 'https://inkadra.test/p/1/b/2' } });
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  writeText.mockClear();
  await act(async () => root.unmount());
  host.remove();
});

describe('DeniedState', () => {
  it('explains the denial and copies the board link to ask for access', async () => {
    await act(async () => root.render(<DeniedState />));
    expect(host.textContent).toContain('board.denied.title');
    expect(host.textContent).toContain('board.denied.body');
    const [copy] = host.querySelectorAll('button');
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith('https://inkadra.test/p/1/b/2');
    expect(host.textContent).toContain('board.denied.copied');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('board.denied.hint');
  });
});
