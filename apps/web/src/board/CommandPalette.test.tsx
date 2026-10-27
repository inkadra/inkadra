// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import i18n from '../i18n/index.ts';
import { CommandPalette } from './chrome.tsx';

it('lists exactly the three template options when an Italian editor types "modello"', async () => {
  await i18n.changeLanguage('it');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <CommandPalette
          readOnly={false}
          onClose={vi.fn()}
          onAdd={vi.fn()}
          onTemplate={vi.fn()}
          onZoom={vi.fn()}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onToggleUnsorted={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      const field = host.querySelector('input');
      if (!field) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        field,
        'modello',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toHaveLength(3);
    for (const option of options) expect(option).toMatch(/^Inserisci modello: /);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
