// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it, vi } from 'vitest';
import {
  elementSections,
  foldIcons,
  itemSummary,
  legendLine,
  supportText,
} from './plan-elements.ts';
import { english as t } from './plan-words.fixture.ts';

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 1000,
  y: 1000,
  ...extra,
});
const key = icon('key', 'cob', { label: 'Key', watts: 300, stand: 'cstand' });
const plan = {
  icons: [
    key,
    icon('box', 'softbox', { on: key.id }),
    icon('cam', 'camera', {
      color: '#9DB8F2',
      lens: 32,
      support: 'dolly',
      steps: [{ x: 1, y: 1 }],
    }),
    icon('anna', 'actor', { color: '#B897F0', pose: 'seated' }),
    // Grip and crew: a flag (Lights layer) and the video village (Camera layer).
    icon('neg', 'flag'),
    icon('village', 'village', { color: '#9DB8F2' }),
    // A flag moved to the Set layer by hand is listed with the Set.
    icon('flag2', 'flag', { layer: 'set' }),
  ],
};

it('lists items by group, modifiers with their light, filtered by group and colour', () => {
  const all = elementSections(plan, { group: 'all', color: null });
  expect(all.map((s) => [s.group, s.items.map((e) => e.item.id.replace(/A+$/, ''))])).toEqual([
    ['lights', ['key']],
    ['camera', ['cam']],
    ['actors', ['anna']],
    ['grip', ['neg', 'village']],
    ['set', ['flag2']],
    ['notes', []],
  ]);
  expect(all.flatMap((s) => s.items).every((e) => e.refs.length === 1)).toBe(true);
  expect(elementSections(plan, { group: 'grip', color: null })).toHaveLength(1);
  const yellow = elementSections(plan, { group: 'lights', color: '#EDD963' });
  expect(yellow.flatMap((s) => s.items).map((e) => e.item.id)).toEqual([key.id]);
});

it('sums up a light, a camera and a person in one line', () => {
  const en = { locale: 'en' };
  expect(itemSummary(key, plan.icons, t, en)).toBe('LED COB 300 W · Softbox · C-stand');
  expect(itemSummary(plan.icons[2] as PlanIcon, plan.icons, t, en)).toBe(
    '32 mm · Dolly · 2 positions',
  );
  expect(itemSummary(plan.icons[3] as PlanIcon, plan.icons, t, en)).toBe('Seated');
});

it('writes the watts of the PDF legend in the app language, not the machine one', () => {
  // The machine writes numbers in English; the sheet is in Italian.
  const own = Number.prototype.toLocaleString;
  const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locale,
    options,
  ) {
    return own.call(this, locale ?? 'en-US', options);
  });
  try {
    const light = icon('key', 'cob', { label: 'Key', watts: 1200 });
    expect(legendLine(light, [light], t, 'it')).toBe('Key · LED COB 1,2K');
  } finally {
    spy.mockRestore();
  }
});

describe('rows as the mockup lists them (decision 0117)', () => {
  // View (500, 333) is grid (2048, 2048); 1 view unit is 4.096 grid units across.
  const at = (vx: number, vy: number) => ({ x: (vx / 1000) * 4096, y: (vy / (1000 / 1.5)) * 4096 });
  const track = icon('track', 'track', { ...at(500, 600), w: 280, h: 20 });
  const dolly = icon('dolly', 'dolly', { ...at(500, 600), on: track.id });
  const cam = icon('acam', 'camera', { ...at(500, 600), label: 'A cam', lens: 32, on: dolly.id });
  const stand = icon('stand', 'cstand', at(100, 100));
  const flag = icon('neg', 'flag', { ...at(100, 100), on: stand.id });
  const lamp = (id: string, x: number) => icon(id, 'practical', { ...at(x, 333), watts: 40 });
  const icons = [track, dolly, cam, stand, flag, lamp('p1', 400), lamp('p2', 500), lamp('p3', 600)];

  it('folds identical lamps, and lists a support with what it carries', () => {
    const rows = elementSections({ icons }, { group: 'all', color: null });
    const of = (g: string) =>
      rows
        .find((s) => s.group === g)
        ?.items.map((e) => [e.item.id.replace(/A+$/, ''), e.refs.length]);
    expect(of('lights')).toEqual([['p1', 3]]);
    // The dolly and its track under the camera, the C-stand under the flag: still in the list,
    // so a base covered on the plan is picked, locked and deleted from it.
    expect(of('camera')).toEqual([
      ['acam', 1],
      ['dolly', 1],
      ['track', 1],
    ]);
    expect(of('grip')).toEqual([
      ['neg', 1],
      ['stand', 1],
    ]);
    const camera = rows.find((s) => s.group === 'camera')?.items ?? [];
    expect(camera.map((e) => !!e.sub)).toEqual([false, true, true]);
    expect(foldIcons(icons.slice(5), icons).map((f) => f.count)).toEqual([3]);
  });

  it('says a dolly on a track with its length', () => {
    expect(supportText(dolly, icons, t, 70, 'en')).toBe('Dolly on 4 m track');
    expect(supportText(dolly, icons, t, undefined, 'en')).toBe('Dolly on track');
    expect(itemSummary(cam, icons, t, { scale: 70, locale: 'en' })).toBe(
      '32 mm · Dolly on 4 m track',
    );
  });

  it("writes a track's length in the app language, not the machine one", () => {
    // The machine writes numbers in English; the app is in Italian.
    const own = Number.prototype.toLocaleString;
    const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
      this: number,
      locale,
      options,
    ) {
      return own.call(this, locale ?? 'en-US', options);
    });
    try {
      const long = { ...track, w: 315 };
      const on = [long, dolly];
      expect(supportText(dolly, on, t, 70, 'it')).toBe('Dolly on 4,5 m track');
      // The locale is required: the host's is not the app's (the Android app runs on Hermes).
      // @ts-expect-error no locale
      supportText(dolly, on, t, 70);
    } finally {
      spy.mockRestore();
    }
  });
});
