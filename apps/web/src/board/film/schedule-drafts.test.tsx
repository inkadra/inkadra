// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { walkTabs } from '../../test/tabs.ts';
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
const notesOf = (host: HTMLElement) =>
  host.querySelector<HTMLTextAreaElement>('.schedule__inspector textarea[maxlength="10000"]');
async function type(field: HTMLTextAreaElement | null, value: string) {
  await act(async () => {
    if (!field) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** The day view, with the day panel beside the calendar. */
async function openDayView(host: HTMLElement) {
  const day = host.querySelector<HTMLInputElement>('input[type="radio"][value="day"]');
  await act(async () => day?.click());
}
/** Waits past the autosave delay. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 700)));

/** Types into the notes, then a colleague saves the same day and the tab comes back. */
async function editThenChangeElsewhere() {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Mine');
  expect(notesOf(host)?.value).toBe('Mine');
  get.mockResolvedValue({ items: [{ ...day, revision: 2, notes: 'Theirs' }], nextCursor: null });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  return { host, notes: () => notesOf(host) };
}

it('saves an edit on its own, a moment after the last change', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 2 }));
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Bring coats');
  expect(put).not.toHaveBeenCalled();
  expect(host.textContent).toContain('schedule.statusSaving');
  await settle();
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0]?.[1]).toMatchObject({ notes: 'Bring coats', revision: 1 });
  expect(host.textContent).toContain('schedule.statusSaved');
});

it('undoes with Ctrl+Z, and saves the undone day too', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  let revision = 1;
  const put = vi.spyOn(api, 'put').mockImplementation(async (_path, body) => {
    revision += 1;
    return { ...day, ...(body as object), revision };
  });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Bring coats');
  await settle();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true })),
  );
  expect(notesOf(host)?.value).toBe('');
  await settle();
  expect(put).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[1]?.[1]).toMatchObject({ notes: '', revision: 2 });
  // Redo puts it back.
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, shiftKey: true }),
    ),
  );
  expect(notesOf(host)?.value).toBe('Bring coats');
});

it('keeps an edit that could not be saved, says so and tries again', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const put = vi.spyOn(api, 'put').mockRejectedValueOnce(new Error('offline'));
  put.mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 2 }));
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Bring coats');
  await settle();
  expect(put).toHaveBeenCalledOnce();
  expect(notesOf(host)?.value).toBe('Bring coats');
  expect(host.textContent).toContain('schedule.statusUnsaved');
  await act(async () => button(host, 'schedule.retryNow')?.click());
  await settle();
  expect(put).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('schedule.statusUnsaved');
});

it('keeps a draft when the day changes elsewhere and lets the user save it over', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 3 }));
  const { host, notes } = await editThenChangeElsewhere();
  await settle();
  // Nothing is saved over the other version until the user chooses.
  expect(put).not.toHaveBeenCalled();
  expect(notes()?.value).toBe('Mine');
  expect(host.textContent).toContain('schedule.staleBody');
  expect(host.textContent).toContain('schedule.statusConflict');

  await act(async () => button(host, 'schedule.staleKeep')?.click());
  expect(host.textContent).not.toContain('schedule.staleBody');
  await settle();
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0]?.[1]).toMatchObject({ notes: 'Mine', revision: 2 });
});

it('reloads the saved version only when the user asks', async () => {
  vi.spyOn(api, 'put').mockImplementation(async () => {
    throw new Error('not expected');
  });
  const { host, notes } = await editThenChangeElsewhere();
  await act(async () => button(host, 'schedule.staleReload')?.click());
  expect(notes()?.value).toBe('Theirs');
  expect(host.textContent).not.toContain('schedule.staleBody');
});

it('walks the day tabs by keyboard, Home and End at the ends, and switches only on a choice', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  const list = host.querySelector('.schedule__tabs');
  await walkTabs(list);
  expect(host.querySelector('.schedule__inspector--wide')).toBeNull();
  const needed = [...(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].at(-1);
  await act(async () => needed?.click());
  expect(host.querySelector('.schedule__inspector--wide')).not.toBeNull();
});

it('keeps undo while the original save is still in flight', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  let complete: (value: unknown) => void = () => {};
  const put = vi.spyOn(api, 'put');
  put.mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 3 }));
  // Install the pending response after the default implementation.
  put.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Pending');
  await settle();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true })),
  );
  expect(notesOf(host)?.value).toBe('');
  await act(async () => complete({ ...day, notes: 'Pending', revision: 2 }));
  await settle();
  expect(put).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[1]?.[1]).toMatchObject({ notes: '', revision: 2 });
});

it('does not let undo silently overwrite an unresolved revision conflict', async () => {
  const put = vi.spyOn(api, 'put');
  const { host, notes } = await editThenChangeElsewhere();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true })),
  );
  expect(notes()?.value).toBe('Mine');
  await settle();
  expect(put).not.toHaveBeenCalled();
  expect(host.textContent).toContain('schedule.statusConflict');
});
it('keeps a draft of a remotely removed day until the user chooses to recreate it', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ items: [{ ...day, notes: 'Mine' }], deleted: [] });
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Mine');
  get.mockResolvedValue({ items: [], nextCursor: null });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(notesOf(host)?.value).toBe('Mine');
  expect(host.textContent).toContain('schedule.statusConflict');
  await act(async () => button(host, 'schedule.staleKeep')?.click());
  await settle();
  expect(post).toHaveBeenCalledWith('/boards/board/schedule/edit', {
    changes: [{ id: day.id, revision: 0, input: expect.objectContaining({ notes: 'Mine' }) }],
  });
});

it('does not undo over a colleague edit fetched after the local edit was saved', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, body) => ({ ...day, ...(body as object), revision: 2 }));
  const host = await mount(<ScheduleView store={store()} boardId="board" />);
  await openDayView(host);
  await type(notesOf(host), 'Mine');
  await settle();
  get.mockResolvedValue({ items: [{ ...day, notes: 'Theirs', revision: 3 }], nextCursor: null });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true })),
  );
  expect(notesOf(host)?.value).toBe('Theirs');
  await settle();
  expect(put).toHaveBeenCalledOnce();
});
