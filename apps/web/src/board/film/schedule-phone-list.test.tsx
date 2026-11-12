// @vitest-environment happy-dom
// On a phone the day is a list in time order (mockup option 8): call above, wrap below.
import type { ScheduleBlock, ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => {
  const t = (key: string, o?: Record<string, unknown>) => (o?.time ? `${key} ${o.time}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../../lib/phone.ts', () => ({ useIsPhone: () => true }));

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
const block = (title: string, duration: number, start: string | null, cast: string[] = []) =>
  ({
    id: crypto.randomUUID(),
    type: 'shot',
    title,
    start,
    duration,
    shotId: null,
    cast,
    departments: [],
  }) satisfies ScheduleBlock;

it('lists the blocks in time order between the call and the wrap, conflicts marked', async () => {
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
    // Stored order is not time order: the last block is fixed before the one above it.
    blocks: [
      block('First', 60, null),
      block('Second', 30, null),
      block('Late', 30, '14:00', ['Elena']),
      block('Overlap', 70, '13:00', ['Elena']),
    ],
  };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ScheduleView store={store} boardId="board" />));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  });
  const list = host.querySelector('.schedule__list');
  expect(host.querySelector('.schedule__grid')).toBeNull();
  expect(
    [...(list?.querySelectorAll('.schedule__row-title') ?? [])].map((el) => el.textContent),
  ).toEqual(['First', 'Second', 'Overlap', 'Late']);
  const marks = [...(list?.querySelectorAll('.schedule__list-mark') ?? [])].map(
    (el) => el.textContent,
  );
  expect(marks).toEqual(['schedule.callAt 08:00', 'schedule.wrapAt 14:30']);
  expect(list?.querySelectorAll('.schedule__row.has-conflict')).toHaveLength(2);
  // The day card carries "N conflicts"; pressing it shows the note and marks the blocks.
  const tag = host.querySelector<HTMLButtonElement>(
    '.schedule__summary-card .schedule__conflict-tag',
  );
  expect(tag?.getAttribute('aria-expanded')).toBe('false');
  await act(async () => tag?.click());
  expect(host.querySelector('.schedule__conflict-note')?.textContent).toBe(
    'schedule.conflictNote 14:00',
  );
  expect(list?.querySelectorAll('.schedule__row.is-hot')).toHaveLength(2);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('.schedule__conflict-note')).toBeNull();
});
