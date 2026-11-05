// @vitest-environment happy-dom
import { type ClassificationCatalogs, DEFAULT_SHOT_CATALOGS } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { ClassificationSettings } from './ClassificationSettings.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/classifications.ts', async (original) => ({
  ...(await original<typeof import('../lib/classifications.ts')>()),
  setClassifications: vi.fn(),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const catalogs: ClassificationCatalogs = {
  revision: 1,
  projectTypes: [
    { id: 'a', label: 'Short film', archived: false },
    { id: 'b', label: 'Commercial', archived: false },
  ],
  tags: [],
  ...structuredClone(DEFAULT_SHOT_CATALOGS),
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

const toggle = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.catalogs__head button')]
    .find((b) => b.textContent?.includes(name))
    ?.click();
const row = (id: string) =>
  [...host.querySelectorAll<HTMLInputElement>('.catalogs__name')][
    catalogs.shotSizes.findIndex((o) => o.id === id)
  ] as HTMLInputElement;
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

it('shows five closed catalogs in two groups, each with a summary', async () => {
  const root = await mount();
  expect(host.querySelectorAll('.catalogs__group')).toHaveLength(2);
  expect(host.querySelectorAll('.catalogs__card')).toHaveLength(5);
  expect(host.querySelectorAll('.catalogs__name')).toHaveLength(0);
  // Movement has ten values: six names and the rest as a number.
  expect(host.querySelectorAll('.catalogs__card')[4]?.textContent).toContain('+4');
  act(() => root.unmount());
});

it('lists a catalog when opened and saves only after a change', async () => {
  const root = await mount();
  await act(async () => toggle('catalogs.projectTypes'));
  const cards = host.querySelectorAll('.catalogs__card');
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
  await act(async () => toggle('catalogs.projectTypes'));
  await act(async () => toggle('catalogs.tags'));
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

it('translates a default until it is renamed, and marks the rename', async () => {
  const root = await mount();
  await act(async () => toggle('catalogs.shotSizes'));
  const input = row('ws');
  expect(input.value).toBe('film.shot.ws');
  expect(host.querySelector('.catalogs__badge.is-renamed')).toBeNull();
  await act(async () => type(input, 'Totale'));
  expect(row('ws').value).toBe('Totale');
  expect(host.querySelector('.catalogs__badge.is-renamed')).not.toBeNull();
  await act(async () => type(row('ws'), 'film.shot.ws'));
  expect(host.querySelector('.catalogs__badge.is-renamed')).toBeNull();
  act(() => root.unmount());
});

it('blocks an empty or repeated name, opening its catalog', async () => {
  const root = await mount();
  await act(async () => toggle('catalogs.shotSizes'));
  await act(async () => type(row('ws'), 'film.shot.ms'));
  expect(host.textContent).toContain('catalogs.duplicate');
  await act(async () => type(row('ws'), 'Totale'));
  expect(host.textContent).not.toContain('catalogs.duplicate');
  await act(async () => type(row('fs'), ''));
  await act(async () => toggle('catalogs.shotSizes'));
  await act(async () => button('settings.save')?.click());
  expect(api.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain('catalogs.required');
  expect(document.activeElement).toBe(row('fs'));
  act(() => root.unmount());
});

it('restores archived defaults, leaving renamed ones and new values alone', async () => {
  const shots = structuredClone(DEFAULT_SHOT_CATALOGS);
  const renamed = { ...shots.shotAngles[0], label: 'Mio', archived: true } as never;
  const custom = { id: crypto.randomUUID(), label: 'Nuova', archived: true };
  const angles = [renamed, { ...shots.shotAngles[1], archived: true }, custom] as never[];
  vi.mocked(api.get).mockResolvedValueOnce({ ...catalogs, shotAngles: angles });
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ClassificationSettings />));
  await act(async () => toggle('catalogs.shotAngles'));
  await act(async () => button('catalogs.restoreDefaults')?.click());
  const archived = [...host.querySelectorAll('.catalogs__row.is-archived input')].map(
    (i) => (i as HTMLInputElement).value,
  );
  expect(archived).toEqual(['Mio', 'Nuova']);
  // Every other default is active again; the one that was archived too.
  expect(host.querySelectorAll('.catalogs__name')).toHaveLength(shots.shotAngles.length + 1);
  act(() => root.unmount());
});

it('names the frame-panel fallback when a list has no active value', async () => {
  const shotMovements = catalogs.shotMovements.map((o) => ({ ...o, archived: true }));
  vi.mocked(api.get).mockResolvedValueOnce({ ...catalogs, shotMovements });
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ClassificationSettings />));
  expect(host.textContent).toContain('catalogs.emptyShots');
  act(() => root.unmount());
});
