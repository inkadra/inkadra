import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Board } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import it_ from '../i18n/it.json';
import { enabledViews, kindFor, screenOf, screenOpen, startBoard, startViews } from './start.ts';
import { playable } from './TourPlayer.tsx';
import { GUEST, stepKeys, TOURS, toursFor, WELCOME } from './tours.ts';

const src = join(__dirname, '..');

/** The app's source, without the tutorials themselves and the tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tutorial' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const all = [WELCOME, GUEST, ...TOURS];

describe('the tours (#502), kept up to date with the interface', () => {
  it('point only at anchors that exist in a component', () => {
    const code = sources(src)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const anchors = new Set(
      all.flatMap((tour) => [tour.offer, ...tour.steps.map((s) => s.anchor)]).filter(Boolean),
    );
    // `data-tour="x"` on an element, or `tour="x"` on a component that passes it on.
    const missing = [...anchors].filter(
      (anchor) => !new RegExp(`(?:data-tour|\\btour)="${anchor}"`).test(code),
    );
    expect(missing, 'add data-tour="…" to the component, or update tours.ts').toEqual([]);
  });

  it('have a name and every step text in the reference catalogue', () => {
    const lookup = (key: string) =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], it_);
    const keys = [
      ...TOURS.map((tour) => `tutorial.tours.${tour.id}.name`),
      ...all.flatMap((tour) => tour.steps.flatMap((_, i) => Object.values(stepKeys(tour.id, i)))),
    ];
    expect(keys.filter((key) => typeof lookup(key) !== 'string')).toEqual([]);
  });

  it('are short: 2 to 7 steps, ids within the preference limit, each once', () => {
    for (const tour of all) {
      expect(tour.steps.length).toBeGreaterThanOrEqual(2);
      expect(tour.steps.length).toBeLessThanOrEqual(7);
      expect(tour.id.length).toBeLessThanOrEqual(40);
    }
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
  });
});

describe('where the tours start', () => {
  // Anchors of the shell, on screen on every page: a tour of them plays where it is.
  const everywhere: Record<string, string> = { demo: 'the demo bar is in every header' };

  it('open the screen their steps point at: a page (`href`) or a board (`start`)', () => {
    const loose = TOURS.filter(
      (tour) =>
        tour.steps.some((step) => step.anchor) && !tour.href && !tour.start && !everywhere[tour.id],
    ).map((tour) => tour.id);
    expect(loose, 'give the tour an href or a start in tours.ts').toEqual([]);
  });

  it('say in one line where a board tour starts, and what a project is missing', () => {
    const lookup = (key: string) =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], it_);
    const keys = [
      ...TOURS.filter((tour) => typeof tour.start === 'object').map(
        (tour) => `tutorial.tours.${tour.id}.where`,
      ),
      ...['storyboard', 'moodboard', 'production'].map((kind) => `tutorial.start.missing.${kind}`),
    ];
    expect(keys.filter((key) => typeof lookup(key) !== 'string')).toEqual([]);
  });

  it('wait for the first anchored step: the Shooting schedule waits for its calendar', () => {
    const schedule = TOURS.find((tour) => tour.id === 'schedule');
    expect(schedule?.start).toEqual({ view: 'schedule' });
    expect(schedule && screenOf(schedule)[0]).toBe('schedule-queue');
  });

  // A stand-in for the elements on screen: `busy` inside a section still loading (aria-busy).
  const on = (shown: Record<string, 'ready' | 'busy'>) => (anchor: string) =>
    shown[anchor]
      ? ({ closest: () => (shown[anchor] === 'busy' ? {} : null) } as unknown as Element)
      : null;

  it('open the Client review on a phone, where the list of frames is hidden', () => {
    const review = TOURS.find((tour) => tour.id === 'review');
    expect(review && screenOpen(screenOf(review), on({ 'review-stage': 'ready' }))).toBe(true);
  });

  it('wait for a screen to load before fixing the steps: the Schedule waits for its days', () => {
    const schedule = TOURS.find((tour) => tour.id === 'schedule');
    const anchors = schedule ? screenOf(schedule) : [];
    expect(screenOpen(anchors, on({ 'schedule-queue': 'busy' }))).toBe(false);
    expect(screenOpen(anchors, on({ 'schedule-queue': 'ready', 'schedule-days': 'ready' }))).toBe(
      true,
    );
    expect(screenOpen(anchors, on({}))).toBe(false);
  });

  const board = (id: string, kind: Board['kind'], parentBoardId: string | null, position: string) =>
    ({ id, kind, parentBoardId, position, views: null }) as unknown as Board;
  const boards = [
    board('root', 'board', null, 'a0'),
    board('story', 'storyboard', 'root', 'a1'),
    board('prod', 'production', 'root', 'a2'),
  ];
  const none = new Map();

  it('play on the board on screen when it has the view, else the first that has it', () => {
    expect(startBoard(boards, none, 'schedule', 'root')?.id).toBe('prod');
    expect(startBoard(boards, none, 'shotlist', 'story')?.id).toBe('story');
    expect(startBoard(boards, none, undefined, 'story')?.id).toBe('story');
    expect(startBoard(boards, none, undefined, undefined)?.id).toBe('root');
    // A board from before 0121 has Review while a guest review link is live.
    expect(startBoard(boards, none, 'review', 'root')?.id).toBe('story');
    const live = new Map([['root', { boardId: 'root', clientReview: true }]]);
    expect(startBoard(boards, live as never, 'review', 'prod')?.id).toBe('root');
  });

  it('offer to make the board a view comes with, never one for Review', () => {
    expect(startBoard(boards.slice(0, 2), none, 'troupe', 'root')).toBeUndefined();
    expect(kindFor('troupe')).toBe('production');
    expect(kindFor('shotlist')).toBe('storyboard');
    expect(kindFor('moodboard')).toBe('moodboard');
    expect(kindFor('review')).toBeNull();
    expect(kindFor(undefined)).toBeNull();
  });

  it('never offer to make a board of a module that is off (decision 0121)', () => {
    expect(kindFor('storyboard', ['storyboard'])).toBeNull();
    expect(kindFor('schedule', ['production'])).toBeNull();
    expect(kindFor('schedule', ['storyboard'])).toBe('production');
  });

  it('keep Presentation while a storyboard or a moodboard can present', () => {
    const ids = (off: string[]) => toursFor(false, false, off).map((tour) => tour.id);
    expect(ids(['storyboard'])).toContain('present');
    expect(ids(['moodboard'])).toContain('present');
    expect(ids(['storyboard', 'moodboard'])).not.toContain('present');
    const present = TOURS.find((tour) => tour.id === 'present');
    const view = typeof present?.start === 'object' ? present.start.view : undefined;
    // With only a moodboard, the tour starts on it.
    const mood = [boards[0] as Board, board('mood', 'moodboard', 'root', 'a3')];
    expect(startBoard(mood, none, view, 'root')?.id).toBe('mood');
    // Storyboard off: the moodboard comes first, and only a moodboard is offered to make.
    const views = enabledViews(startViews(view), ['storyboard']);
    expect(views).toEqual(['moodboard']);
    expect(startBoard(boards, none, views, 'root')).toBeUndefined();
    expect(enabledViews(startViews(view), [])).toEqual(['storyboard', 'moodboard']);
  });
});

describe('the tours of modules (decision 0121)', () => {
  it('leave out the tours of a module that is off, and keep the others', () => {
    const ids = (off: string[]) => toursFor(false, false, off).map((tour) => tour.id);
    expect(ids([])).toEqual(expect.arrayContaining(['storyboard', 'setplan', 'modules']));
    const off = ids(['storyboard', 'plan']);
    expect(off).not.toContain('storyboard');
    expect(off).not.toContain('shotlist');
    expect(off).not.toContain('setplan');
    expect(off).toEqual(expect.arrayContaining(['board', 'moodboard', 'modules']));
  });
});

describe('the board tour', () => {
  it('describes only the empty board’s tiles on the step that points at them', async () => {
    const step = TOURS.find((tour) => tour.id === 'board')?.steps.findIndex(
      (s) => s.anchor === 'canvas-start',
    );
    expect(step).toBeGreaterThanOrEqual(0);
    for (const lang of ['de', 'en', 'es', 'fr', 'it', 'pt']) {
      const catalogue = (await import(`../i18n/${lang}.json`)).default;
      const text: string = catalogue.tutorial.tours.board.steps[String(step)].text;
      // New board is a dialog elsewhere: the spotlight on the tiles cannot show it.
      expect(text, lang).not.toContain(catalogue.home.newBoard.title);
    }
  });
});

describe('the schedule tour', () => {
  it('shows drawing a block and moving a whole day by its heading (0089, phases 2 and 3)', () => {
    const schedule = TOURS.find((tour) => tour.id === 'schedule');
    const anchors = schedule?.steps.map((step) => step.anchor);
    expect(anchors).toContain('schedule-day-head');
    expect(anchors?.indexOf('schedule-day-head')).toBeLessThan(
      anchors?.indexOf('schedule-save') ?? -1,
    );
  });
});

describe('the steps a tour plays', () => {
  const steps = [
    { anchor: 'a', media: 'types' as const },
    { anchor: null, media: 'gear' as const },
    { anchor: 'b', media: 'drag' as const },
  ];

  it('skip a step whose anchor is not on screen, and keep the card-only ones', () => {
    expect(playable(steps, (a) => a === 'a').map((s) => s.index)).toEqual([0, 1]);
  });

  it('turn into cards when none of the anchors is here, instead of a blank screen', () => {
    const shown = playable(steps, () => false);
    expect(shown.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(shown.every((s) => s.step.anchor === null)).toBe(true);
  });
});
