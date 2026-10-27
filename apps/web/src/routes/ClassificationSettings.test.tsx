// @vitest-environment happy-dom
import type { ClassificationCatalogs } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ClassificationSettings } from './ClassificationSettings.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/classifications.ts', () => ({ setClassifications: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const catalogs: ClassificationCatalogs = {
  revision: 1,
  projectTypes: [
    { id: 'a', label: 'Short film', archived: false },
    { id: 'b', label: 'Commercial', archived: false },
  ],
  tags: [],
};

let host: HTMLDivElement;
afterEach(() => {
  host?.remove();
  vi.clearAllMocks();
});

async function mount() {
  vi.mocked(api.get).mockResolvedValueOnce(structuredClone(catalogs));
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ClassificationSettings />));
  return root;
}
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);

it('lists each catalog in its own card and saves only after a change', async () => {
  const root = await mount();
  const cards = host.querySelectorAll('.catalogs__card');
  expect(cards).toHaveLength(2);
  expect(cards[1]?.textContent).toContain('catalogs.empty');
  expect(host.querySelectorAll('.catalogs__name')).toHaveLength(2);
  expect(button('settings.save')?.disabled).toBe(true);

  await act(async () => button('catalogs.archive')?.click());
  expect(host.querySelector('.catalogs__row.is-archived')).not.toBeNull();
  expect(host.textContent).toContain('catalogs.unsaved');
  expect(button('settings.save')?.disabled).toBe(false);

  await act(async () => button('catalogs.discard')?.click());
  expect(host.querySelector('.catalogs__row.is-archived')).toBeNull();
  expect(button('settings.save')?.disabled).toBe(true);
  act(() => root.unmount());
});

it('moves a value down and focuses a newly added one', async () => {
  const root = await mount();
  const down = host.querySelector<HTMLButtonElement>('button[aria-label="catalogs.down"]');
  await act(async () => down?.click());
  const names = [...host.querySelectorAll<HTMLInputElement>('.catalogs__name')].map((i) => i.value);
  expect(names).toEqual(['Commercial', 'Short film']);
  const add = host.querySelectorAll<HTMLButtonElement>('.catalogs__add')[1];
  await act(async () => add?.click());
  expect(document.activeElement).toBe(
    host.querySelectorAll('.catalogs__card')[1]?.querySelector('input'),
  );
  act(() => root.unmount());
});
