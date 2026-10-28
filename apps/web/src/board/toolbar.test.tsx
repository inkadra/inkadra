// @vitest-environment happy-dom

import { kindColor } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TOOLS, Toolbar } from './chrome.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('groups tools with described tooltips while preserving actions and pressed modes', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onAdd = vi.fn();
  const onTool = vi.fn();
  try {
    await act(async () => root.render(<Toolbar tool="hand" onAdd={onAdd} onTool={onTool} />));
    expect(host.querySelector('.toolbar__btn--note')?.getAttribute('style')).toContain(
      '--kind-fg: var(--ink-tag-yellow)',
    );
    expect(host.querySelector('.toolbar__btn--storyboard')?.getAttribute('style')).toContain(
      '--kind-fg: var(--ink-tag-purple)',
    );
    expect(host.querySelectorAll('fieldset')).toHaveLength(3);
    expect(host.querySelectorAll('button')).toHaveLength(12);
    for (const button of host.querySelectorAll('button')) {
      expect(
        host
          .querySelector(`[id="${button.getAttribute('aria-describedby')}"]`)
          ?.getAttribute('role'),
      ).toBe('tooltip');
      expect(button.getAttribute('aria-keyshortcuts')).toBeTruthy();
    }
    expect(host.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe(
      'board.tools.hand',
    );
    host.querySelector<HTMLButtonElement>('.toolbar__btn--note')?.click();
    host.querySelector<HTMLButtonElement>('.toolbar__btn--arrow')?.click();
    expect(onAdd).toHaveBeenCalledWith('note');
    expect(onTool).toHaveBeenCalledWith('arrow');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('covers every tool with an explicit semantic colour', () => {
  for (const { type } of TOOLS) expect(Object.hasOwn(kindColor, type)).toBe(true);
});
