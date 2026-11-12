// @vitest-environment happy-dom
// The week view as in the approved mockup "Piano riprese v2": what a card shows at its height,
// lanes, a free day, the hours column while the days scroll sideways, and a version conflict.
import type { ScheduleBlock, ShootingDay } from '@inkadra/shared';
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
// Monday 2 November; Tuesday 3 has no shooting.
const monday: ShootingDay = {
  id: 'day-1',
  boardId: 'board',
  projectId: 'project',
  revision: 1,
  date: '2026-11-02',
  callTime: '08:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [
    block('Short', 30),
    block('Meta', 58),
    block('Two lines', 62),
    block('Left', 60, '12:00'),
    block('Right', 60, '12:00'),
  ],
};
const wednesday: ShootingDay = { ...monday, id: 'day-2', date: '2026-11-04', blocks: [] };
const card = (host: HTMLElement, title: string) =>
  [...host.querySelectorAll<HTMLElement>('.schedule__block')].find(
    (el) => el.querySelector('.schedule__block-title')?.textContent === title,
  );

it('puts start and title on one line, then cast and duration; in a lane the title first', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday, wednesday], nextCursor: null });
  const host = await mount();
  // Under 40 px: one line, no meta.
  expect(card(host, 'Short')?.classList.contains('is-short')).toBe(true);
  expect(card(host, 'Short')?.querySelector('.schedule__block-meta')).toBeNull();
  // From 40 px: "start title" on the first line, "cast · duration" under it.
  const meta = card(host, 'Meta');
  expect(meta?.querySelector('.schedule__block-line')?.textContent).toBe('08:30Meta');
  expect(meta?.querySelector('.schedule__block-meta')?.textContent).toBe('Elena · 58 min');
  expect(meta?.classList.contains('is-wrap')).toBe(false);
  // From a 56 px card the title may take two lines; the full range stays in the name.
  const two = card(host, 'Two lines');
  expect(two?.classList.contains('is-wrap')).toBe(true);
  expect(two?.querySelector('.schedule__block-time')?.textContent).toBe('09:28');
  expect(two?.querySelector('button')?.getAttribute('aria-label')).toContain('09:28 – 10:30');
  // Side by side, 2 px apart: the title first, then "start · cast · duration".
  const left = card(host, 'Left');
  const right = card(host, 'Right');
  expect(left?.querySelector('.schedule__block-text > :first-child')?.textContent).toBe('Left');
  expect(left?.querySelector('.schedule__block-meta')?.textContent).toBe('12:00 · Elena · 1h');
  expect(right?.querySelector('.schedule__block-time')?.textContent).toBe('12:00');
  expect(left?.style.right).toBe('calc(50% + 1px)');
  expect(right?.style.left).toBe('calc(50% + 1px)');
});

it('marks a free day of the week and keeps the hours in view when the days scroll sideways', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [monday, wednesday], nextCursor: null });
  const host = await mount();
  // A narrow column, still named and reachable from its heading.
  const free = host.querySelector('.schedule__column.is-free');
  expect(free?.classList.contains('is-narrow')).toBe(true);
  expect(free?.textContent).toBe('schedule.freeShort');
  const head = host.querySelector('.schedule__head.is-free');
  expect(head?.classList.contains('is-narrow')).toBe(true);
  expect(head?.textContent).not.toContain('schedule.freeHeadHint');
  expect(head?.querySelector('button')?.getAttribute('aria-label')).toContain('schedule.freeDay');
  expect(head?.querySelector('button')?.getAttribute('data-day-drop')).toBe('2026-11-03');
  const calendar = host.querySelector<HTMLElement>('.schedule__calendar');
  if (!calendar) throw new Error('no calendar');
  calendar.scrollLeft = 200;
  await act(async () => calendar.dispatchEvent(new Event('scroll')));
  // The hours column (and the corner above it) moves with the scroll, so it stays on screen.
  expect(calendar.style.getPropertyValue('--schedule-scroll-x')).toBe(`${calendar.scrollLeft}px`);
});

it('offers both versions of a day changed elsewhere in the week view', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [monday], nextCursor: null });
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, body) => ({ ...monday, ...(body as object), revision: 3 }));
  const host = await mount();
  // An edit in the day panel, then a colleague saves the same day, back in the week.
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="radio"][value="day"]')?.click(),
  );
  const notes = host.querySelector<HTMLTextAreaElement>(
    '.schedule__inspector textarea[maxlength="10000"]',
  );
  await act(async () => {
    if (!notes) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      notes,
      'Mine',
    );
    notes.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="radio"][value="week"]')?.click(),
  );
  get.mockResolvedValue({ items: [{ ...monday, revision: 2, notes: 'Theirs' }], nextCursor: null });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(host.querySelector('.schedule__inspector')).toBeNull();
  const banner = host.querySelector('.schedule__stale-banners');
  expect(banner?.textContent).toContain('schedule.staleBody');
  const keep = [...(banner?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === 'schedule.staleKeep',
  );
  expect([...(banner?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
    'schedule.staleReload',
    'schedule.staleKeep',
  ]);
  await act(async () => keep?.click());
  expect(host.querySelector('.schedule__stale-banners')).toBeNull();
  await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
  expect(put.mock.calls[0]?.[1]).toMatchObject({ notes: 'Mine', revision: 2 });
});
