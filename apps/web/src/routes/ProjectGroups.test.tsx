// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ProjectGroupDialog } from './ProjectGroups.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [] })), post: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('creates a group with its name and colour', async () => {
  const close = vi.fn();
  vi.mocked(api.post).mockResolvedValue({
    id: 'g1',
    name: 'Caffè Aurora',
    color: 'orange',
    position: 'a0',
    collapsed: false,
  });
  await act(async () => root.render(<ProjectGroupDialog onClose={close} />));
  const input = document.querySelector<HTMLInputElement>('dialog input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'Caffè Aurora',
    );
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="appearance.colors.orange"]')?.click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(),
  );
  expect(api.post).toHaveBeenCalledWith('/project-groups', {
    name: 'Caffè Aurora',
    color: 'orange',
  });
  expect(close).toHaveBeenCalled();
});
