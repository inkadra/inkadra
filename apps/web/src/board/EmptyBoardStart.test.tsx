// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyBoardStart } from './EmptyBoardStart.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('EmptyBoardStart', () => {
  it('offers screenplay import without templates', async () => {
    const handlers = {
      onScreenplay: vi.fn(),
    };
    await act(async () => root.render(<EmptyBoardStart {...handlers} />));
    expect(host.querySelector('h2')?.textContent).toBe('board.empty.title');
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'board.empty.screenplayboard.empty.screenplayBody',
    ]);
    for (const b of buttons) await act(async () => b.click());
    expect(handlers.onScreenplay).toHaveBeenCalledOnce();
    // Mouse and touch wording are both there; the stylesheet shows the one that fits.
    expect(host.textContent).toContain('board.empty.bodyTouch');
    expect(host.textContent).toContain('board.empty.hintTouch');
  });
});
