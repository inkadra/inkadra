// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NumberField } from './NumberField.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));

it('steps with the arrows, within its limits', async () => {
  const commit = vi.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <NumberField
        value={3.95}
        min={1}
        max={4}
        step={0.01}
        nudge={0.1}
        label="L"
        onCommit={commit}
      />,
    ),
  );
  const input = host.querySelector('input') as HTMLInputElement;
  const press = (key: string) =>
    act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await press('ArrowDown');
  expect(commit).toHaveBeenLastCalledWith(3.85);
  await press('ArrowUp');
  await press('ArrowUp');
  expect(commit).toHaveBeenLastCalledWith(4);
  await act(async () => root.unmount());
});
