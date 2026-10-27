// @vitest-environment happy-dom
import type { SearchHit } from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PaletteAction } from '../commands/actions.ts';
import { api } from '../lib/api.ts';
import { SearchDialog } from './SearchDialog.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn() },
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
  vi.mocked(api.get).mockReset();
});

const close = vi.fn();
afterEach(() => close.mockReset());

const render = (actions: PaletteAction[], open = true) =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <button type="button" id="opener">
          open
        </button>
        {open && <SearchDialog projects={[]} shared={[]} onClose={close} actions={actions} />}
      </MemoryRouter>,
    ),
  );
const input = () => host.querySelector<HTMLInputElement>('input.search__input');
const key = (k: string) =>
  act(async () => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
async function type(text: string) {
  await act(async () => {
    const field = input();
    if (!field) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Past the search debounce, with the response settled.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
}

const hit: SearchHit = {
  kind: 'project',
  projectId: 'p1',
  projectName: 'Newsroom',
  title: 'Newsroom',
  tags: [],
} as unknown as SearchHit;

it('runs an action with Enter only once it is selected, and closes with Escape', async () => {
  const first = vi.fn();
  const second = vi.fn();
  await render([
    { id: 'first', label: 'New project', run: first },
    { id: 'second', label: 'Switch theme', run: second, hint: 'T' },
  ]);
  expect(document.activeElement).toBe(input());
  expect(input()?.getAttribute('aria-activedescendant')).toBeNull();
  await key('Enter');
  expect(first).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await key('ArrowDown');
  await key('ArrowDown');
  expect(input()?.getAttribute('aria-activedescendant')).toBe('search-option-1');
  expect(host.querySelector('#search-option-1')?.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('[role="listbox"] > [role="group"] [role="option"]')).not.toBeNull();
  expect(host.querySelector('dialog')?.hasAttribute('aria-modal')).toBe(false);
  await key('Enter');
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  await key('Escape');
  expect(close).toHaveBeenCalledTimes(2);
});

it('does nothing on Enter when the search finds nothing, even if actions match', async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  const create = vi.fn();
  await render([{ id: 'new', label: 'New project', run: create }]);
  await type('new');
  expect(host.textContent).toContain('New project');
  await key('Enter');
  expect(create).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('lists search results before actions and selects the first result', async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [hit] });
  const create = vi.fn();
  await render([{ id: 'new', label: 'New project', run: create }]);
  await type('new');
  const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options[0]).toContain('Newsroom');
  expect(options[1]).toContain('New project');
  expect(input()?.getAttribute('aria-activedescendant')).toBe('search-option-0');
  await key('ArrowDown');
  await key('Enter');
  expect(create).toHaveBeenCalledOnce();
});

it('returns focus to the element that opened it', async () => {
  await render([], false);
  host.querySelector<HTMLButtonElement>('#opener')?.focus();
  await render([]);
  expect(document.activeElement).toBe(input());
  await render([], false);
  expect(document.activeElement).toBe(host.querySelector('#opener'));
});
