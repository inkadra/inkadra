// @vitest-environment happy-dom
import { addFrame, createElement } from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import {
  DEFAULT_USER_PREFERENCES,
  type ScheduleBlock,
  type ShootingDay,
  type UserPreferences,
} from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// The account's preferences: what the server holds, and what the schedule asks it to save.
const prefs = vi.hoisted(() => ({
  value: {} as Partial<UserPreferences>,
  saved: [] as Array<Partial<UserPreferences>>,
}));
vi.mock('../../lib/preferences.ts', async (original) => ({
  ...(await original<typeof import('../../lib/preferences.ts')>()),
  usePreferences: () => ({ ...DEFAULT_USER_PREFERENCES, ...prefs.value }),
  updatePreferences: async (patch: Partial<UserPreferences>) => {
    prefs.saved.push(patch);
    prefs.value = { ...prefs.value, ...patch };
  },
}));

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  prefs.value = {};
  prefs.saved = [];
  for (const dispose of disposals.splice(0).reverse()) dispose();
});

const opts = { userId: null };
const block = (shotId: string): ScheduleBlock => ({
  id: crypto.randomUUID(),
  type: 'shot',
  title: '',
  start: null,
  duration: 30,
  shotId,
  cast: [],
  departments: [],
});
const camera = (id: string, frameId: string): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind: 'camera',
  color: '#9DB8F2',
  x: 1000,
  y: 1000,
  frameId,
});

/**
 * Scene 1 has Wide (base setup), Pour (second setup) and Both (in both setups); scene 2 is
 * omitted, with Gone; scene 3 has Exit, in no setup. The day shoots Pour, Gone and Exit.
 */
async function mount() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const s1 = createElement(
    doc,
    'scene',
    { x: 0, y: 0 },
    { number: '1', title: 'Bar', location: '', setting: 'int', time: 'day' },
    opts,
  );
  const s2 = createElement(
    doc,
    'scene',
    { x: 0, y: 400 },
    { number: '2', title: 'Cut', location: '', setting: 'int', time: 'day', omitted: true },
    opts,
  );
  const s3 = createElement(
    doc,
    'scene',
    { x: 0, y: 800 },
    { number: '3', title: 'Car', location: '', setting: 'ext', time: 'day' },
    opts,
  );
  const wide = addFrame(doc, s1.id, null, { action: 'Wide' }, opts);
  const pour = addFrame(doc, s1.id, null, { action: 'Pour' }, opts);
  const both = addFrame(doc, s1.id, null, { action: 'Both' }, opts);
  const gone = addFrame(doc, s2.id, null, { action: 'Gone' }, opts);
  const exit = addFrame(doc, s3.id, null, { action: 'Exit' }, opts);
  const base = createElement(
    doc,
    'plan',
    { x: 600, y: 0 },
    { w: 400, title: 'Bar', icons: [camera('a', wide.id), camera('b', both.id)] },
    opts,
  );
  createElement(
    doc,
    'plan',
    { x: 600, y: 400 },
    {
      w: 400,
      variantOf: base.id,
      variant: 'Close',
      icons: [camera('c', pour.id), camera('d', both.id), camera('e', gone.id)],
    },
    opts,
  );
  const day: ShootingDay = {
    id: crypto.randomUUID(),
    boardId: 'board',
    projectId: crypto.randomUUID(),
    revision: 1,
    date: '2026-11-02',
    callTime: '08:00',
    wrap: null,
    location: '',
    notes: '',
    blocks: [block(pour.id), block(gone.id), block(exit.id)],
  };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ScheduleView store={store} boardId="board" />
      </MemoryRouter>,
    ),
  );
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  });
  return { host, day };
}
/** Each section of setups: its heading and the texts of its shots. */
const sections = (scope: ParentNode, shot: string) =>
  [...scope.querySelectorAll('.schedule__setup')].map((s) => [
    s.querySelector('.schedule__setup-title')?.textContent,
    [...s.querySelectorAll(shot)].map((b) => b.textContent),
  ]);
const queue = (host: HTMLElement) => host.querySelector('.schedule__queue') as HTMLElement;

it('groups the queue by scene until this person picks Setup, saved in their preferences', async () => {
  const { host } = await mount();
  const select = queue(host).querySelector<HTMLButtonElement>(
    '[role="combobox"][aria-label="film.list.groupBy"]',
  );
  expect(select?.textContent).toContain('film.list.groupScene');
  expect(queue(host).querySelector('.schedule__setup')).toBeNull();
  // happy-dom has no popover API, which the shared Select opens its list with.
  HTMLElement.prototype.showPopover ??= () => {};
  HTMLElement.prototype.hidePopover ??= () => {};
  await act(async () => select?.click());
  const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
    o.textContent?.includes('film.list.groupSetup'),
  ) as HTMLElement;
  await act(async () => option.click());
  expect(prefs.saved).toEqual([{ shotGroupBy: 'setup' }]);
  // Scene 1's waiting shots under their setups, in the plans' order; Both under each.
  expect(sections(queue(host), '.schedule__shot-action')).toEqual([
    ['1 · board.plan.base', ['Wide', 'Both']],
    ['2 · Close', ['Both']],
  ]);
  // Counted once: Wide and Both wait; the omitted scene's Gone is not offered.
  expect(queue(host).querySelector('.story__sidebar-title span')?.textContent).toBe('2');
  expect(queue(host).textContent).not.toContain('Gone');
});

it("lists the day's shots under their setups, without omitted scenes, and opens a block", async () => {
  prefs.value = { shotGroupBy: 'setup' };
  const { host, day } = await mount();
  const dayRadio = host.querySelector<HTMLInputElement>('input[type="radio"][value="day"]');
  await act(async () => dayRadio?.click());
  const tab = [...host.querySelectorAll('[role="tab"]')].find(
    (b) => b.textContent === 'schedule.tabBlock',
  ) as HTMLElement;
  await act(async () => tab.click());
  const list = host.querySelector('.schedule__day-setups') as HTMLElement;
  const texts = sections(list, '.schedule__day-shot');
  expect(texts.map(([title]) => title)).toEqual(['2 · Close', 'film.list.noSetup']);
  // Each shot named as the calendar names it, so no button is left without a name.
  expect(texts.flatMap(([, shots]) => shots).every((s) => /Pour|Exit/.test(String(s)))).toBe(true);
  expect(list.textContent).not.toContain('Gone');
  const pour = [...list.querySelectorAll('button')].find((b) => b.textContent?.includes('Pour'));
  await act(async () => pour?.click());
  // The block's editor replaces the list: the block of Pour is selected in the calendar.
  expect(host.querySelector('.schedule__day-setups')).toBeNull();
  expect(
    host.querySelector(`[data-block="${day.blocks[0]?.id}"]`)?.getAttribute('aria-pressed'),
  ).toBe('true');
});

it('offers no grouping on a board without set plans', async () => {
  prefs.value = { shotGroupBy: 'setup' };
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const scene = createElement(
    doc,
    'scene',
    { x: 0, y: 0 },
    { number: '1', title: '', location: '', setting: 'int', time: 'day' },
    opts,
  );
  addFrame(doc, scene.id, null, { action: 'Wide' }, opts);
  vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ScheduleView store={store} boardId="board" />
      </MemoryRouter>,
    ),
  );
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  });
  expect(queue(host).querySelector('[aria-label="film.list.groupBy"]')).toBeNull();
  expect(queue(host).querySelector('.schedule__setup')).toBeNull();
});
