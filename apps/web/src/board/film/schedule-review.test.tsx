// @vitest-environment happy-dom
// Follow-ups to the week's polish: hours past midnight, the folded column while the queue loads
// and one accessible name per day's "N conflicts".
import type { ScheduleBlock, ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { SIDE_KEY } from './calendar.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => {
  // The options in the text, so names built from them can be told apart.
  const t = (key: string, options?: object) => (options ? `${key}${JSON.stringify(options)}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
async function mount() {
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
  return host;
}
const block = (title: string, duration: number, start: string | null = null): ScheduleBlock => ({
  id: crypto.randomUUID(),
  type: 'shot',
  title,
  start,
  duration,
  shotId: null,
  cast: ['Elena'],
  departments: [],
});
const shootingDay = (id: string, date: string, callTime: string, blocks: ScheduleBlock[]) =>
  ({
    id,
    boardId: 'board',
    projectId: 'project',
    revision: 1,
    date,
    callTime,
    wrap: null,
    location: '',
    notes: '',
    blocks,
  }) satisfies ShootingDay;

it('marks every hour past midnight with (+1)', async () => {
  const night = shootingDay('night', '2026-11-02', '22:00', [block('Notte', 240)]);
  vi.spyOn(api, 'get').mockResolvedValue({ items: [night], nextCursor: null });
  const host = await mount();
  const hours = [...host.querySelectorAll('.schedule__grid .schedule__hour')].map(
    (el) => el.textContent,
  );
  expect(hours).toContain('23:00');
  expect(hours).toContain('00:00(+1)');
  expect(hours).toContain('01:00(+1)');
});

it('gives each day’s "N conflicts" its own accessible name', async () => {
  const both = () => [block('A', 60, '09:00'), block('B', 60, '09:00')];
  const days = [
    shootingDay('d1', '2026-11-02', '08:00', both()),
    shootingDay('d2', '2026-11-03', '08:00', both()),
  ];
  vi.spyOn(api, 'get').mockResolvedValue({ items: days, nextCursor: null });
  const host = await mount();
  const tags = [...host.querySelectorAll('.schedule__conflict-tag')];
  expect(tags).toHaveLength(2);
  const names = tags.map((tag) => tag.getAttribute('aria-label'));
  expect(new Set(names).size).toBe(2);
  // The visible text starts the name.
  for (const tag of tags) expect(tag.getAttribute('aria-label')).toMatch(/^schedule\.conflictTag/);
  expect(tags[0]?.textContent).toBe('schedule.conflictTag{"count":2}');
});

it('keeps the column folded while the queue loads, unless the person opened it', async () => {
  vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}));
  let host = await mount();
  expect(host.querySelector('.schedule__rail')).not.toBeNull();
  expect(host.querySelector('.schedule__queue')).toBeNull();
  for (const dispose of disposals.splice(0).reverse()) dispose();
  localStorage.setItem(SIDE_KEY, 'open');
  host = await mount();
  expect(host.querySelector('.schedule__queue')).not.toBeNull();
  expect(host.querySelector('.schedule__rail')).toBeNull();
});
