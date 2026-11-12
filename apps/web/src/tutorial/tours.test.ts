import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import it_ from '../i18n/it.json';
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
