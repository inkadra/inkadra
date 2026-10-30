// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
function store() {
  const doc = new Y.Doc();
  const value = new BoardStore(doc);
  disposals.push(() => {
    value.destroy();
    doc.destroy();
  });
  return value;
}
function button(scope: ParentNode, label: string) {
  return [...scope.querySelectorAll('button')].find((item) => item.textContent === label);
}
const day: ShootingDay = {
  id: 'day-1',
  boardId: 'board',
  projectId: 'project',
  revision: 1,
  date: '2026-11-02',
  callTime: '08:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [],
};
/** Types into the notes, then a colleague saves the same day and the tab comes back. */
async function editThenChangeElsewhere() {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  const notes = () =>
    host.querySelector<HTMLTextAreaElement>('.schedule__inspector textarea[maxlength="10000"]');
  await act(async () => {
    const field = notes();
    if (!field) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      field,
      'Mine',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(notes()?.value).toBe('Mine');
  get.mockResolvedValue({ items: [{ ...day, revision: 2, notes: 'Theirs' }], nextCursor: null });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  return { host, notes };
}

it('keeps a draft when the day changes elsewhere and lets the user save it over', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 3 }));
  const { host, notes } = await editThenChangeElsewhere();
  expect(notes()?.value).toBe('Mine');
  expect(host.textContent).toContain('schedule.staleBody');
  expect(button(host, 'schedule.save')?.disabled).toBe(true);

  await act(async () => button(host, 'schedule.staleKeep')?.click());
  expect(host.textContent).not.toContain('schedule.staleBody');
  await act(async () => button(host, 'schedule.save')?.click());
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0]?.[1]).toMatchObject({ notes: 'Mine', revision: 2 });
  expect(host.textContent).not.toContain('schedule.unsaved');
});

it('reloads the saved version only when the user asks', async () => {
  const { host, notes } = await editThenChangeElsewhere();
  await act(async () => button(host, 'schedule.staleReload')?.click());
  expect(notes()?.value).toBe('Theirs');
  expect(host.textContent).not.toContain('schedule.staleBody');
});
