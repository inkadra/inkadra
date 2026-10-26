// @vitest-environment happy-dom
import type { ScheduleBlock, ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => {
  // The date is interpolated so the test can see the day named in the dialog.
  const t = (key: string, options?: { date?: string }) =>
    options?.date ? `${key}:${options.date}` : key;
  return { useTranslation: () => ({ t }) };
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
function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  return { doc, store };
}
/** happy-dom does not implement the native modal API used by the shared Dialog. */
function nativeModal() {
  return vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
}
function button(scope: ParentNode, label: string) {
  return [...scope.querySelectorAll('button')].find((item) => item.textContent === label);
}
function block(patch: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: crypto.randomUUID(),
    type: 'setup',
    title: '',
    start: null,
    duration: 30,
    shotId: null,
    cast: [],
    departments: [],
    ...patch,
  };
}
function shootingDay(blocks: ScheduleBlock[]): ShootingDay {
  return {
    id: crypto.randomUUID(),
    boardId: 'board',
    projectId: crypto.randomUUID(),
    revision: 1,
    date: '2026-11-02',
    callTime: '08:00',
    wrap: null,
    location: '',
    notes: '',
    blocks,
  };
}

it('deletes a shooting day only after the confirmation dialog is accepted', async () => {
  const { store } = board();
  nativeModal();
  const day = shootingDay([]);
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const remove = vi.spyOn(api, 'delete').mockResolvedValue(null);
  const host = await mount(<ScheduleView store={store} boardId="board" />);
  const trigger = button(host, 'schedule.deleteDay');
  expect(trigger).toBeDefined();

  await act(async () => trigger?.click());
  const dialog = host.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  expect(dialog?.textContent).toContain('schedule.deleteDayTitle');
  expect(dialog?.textContent).toContain('2026-11-02');
  expect(remove).not.toHaveBeenCalled();

  await act(async () => button(dialog as HTMLElement, 'schedule.cancel')?.click());
  expect(remove).not.toHaveBeenCalled();
  expect(dialog?.open).toBe(false);

  // Escape closes the native dialog, which reaches the shared Dialog as a close event.
  await act(async () => trigger?.click());
  expect(dialog?.open).toBe(true);
  await act(async () => {
    if (dialog) dialog.open = false;
    dialog?.dispatchEvent(new Event('close'));
  });
  expect(remove).not.toHaveBeenCalled();
  expect(dialog?.open).toBe(false);

  await act(async () => trigger?.click());
  await act(async () => button(dialog as HTMLElement, 'schedule.delete')?.click());
  expect(remove).toHaveBeenCalledOnce();
  expect(remove.mock.calls[0]?.[0]).toContain(`/boards/board/schedule/${day.id}`);
});

it('asks before removing a block with content but drops empty blocks directly', async () => {
  const { store } = board();
  nativeModal();
  const titled = block({ title: 'Camera rehearsal' });
  const empty = block({ type: 'break' });
  const day = shootingDay([titled, empty]);
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = await mount(<ScheduleView store={store} boardId="board" />);
  const articles = () => [...host.querySelectorAll('.schedule__block')];
  const removeIn = async (article: Element | undefined) => {
    const target = article ? button(article, 'schedule.removeBlock') : undefined;
    await act(async () => target?.click());
  };
  expect(articles()).toHaveLength(2);

  // The empty block carries nothing to lose: it goes without a question.
  await removeIn(articles()[1]);
  expect(articles()).toHaveLength(1);
  expect(host.querySelector('dialog')?.open).toBe(false);

  // The titled block asks first, and Cancel keeps it.
  await removeIn(articles()[0]);
  const dialog = host.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  expect(dialog?.textContent).toContain('schedule.removeBlockTitle');
  expect(articles()).toHaveLength(1);

  await act(async () => button(dialog as HTMLElement, 'schedule.cancel')?.click());
  expect(articles()).toHaveLength(1);
  expect(dialog?.open).toBe(false);

  await removeIn(articles()[0]);
  await act(async () =>
    button(host.querySelector('dialog') as HTMLElement, 'schedule.delete')?.click(),
  );
  expect(articles()).toHaveLength(0);
});
