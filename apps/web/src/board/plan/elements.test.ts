// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  elementSections,
  foldIcons,
  itemSummary,
  seatsAround,
  selectionMix,
  supportText,
} from './elements.ts';

const t = ((key: string, o?: { count?: number }) =>
  o?.count !== undefined
    ? `${o.count} ${key.split('.').at(-1)}`
    : key.split('.').at(-1)) as unknown as TFunction;
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
  expect(itemSummary(key, plan.icons, t)).toBe('cob 300 W · softbox · cstand');
  expect(itemSummary(plan.icons[2] as PlanIcon, plan.icons, t)).toBe('32 mm · dolly · 2 positions');
  expect(itemSummary(plan.icons[3] as PlanIcon, plan.icons, t)).toBe('seated');
  expect(selectionMix(plan.icons.slice(0, 4), t)).toBe('2 lights, 1 camera, 1 actors');
});

describe('rows as the mockup lists them (decision 0116)', () => {
  const t2 = ((key: string, o?: Record<string, unknown>) =>
    o
      ? `${key.split('.').at(-1)}:${Object.values(o).join(',')}`
      : key.split('.').at(-1)) as unknown as TFunction;
  // View (500, 333) is grid (2048, 2048); 1 view unit is 4.096 grid units across.
  const at = (vx: number, vy: number) => ({ x: (vx / 1000) * 4096, y: (vy / (1000 / 1.5)) * 4096 });
  const track = icon('track', 'track', { ...at(500, 600), w: 280, h: 20 });
  const dolly = icon('dolly', 'dolly', { ...at(500, 600), on: track.id });
  const cam = icon('acam', 'camera', { ...at(500, 600), label: 'A cam', lens: 32, on: dolly.id });
  const stand = icon('stand', 'cstand', at(100, 100));
  const flag = icon('neg', 'flag', { ...at(100, 100), on: stand.id });
  const lamp = (id: string, x: number) => icon(id, 'practical', { ...at(x, 333), watts: 40 });
  const counter = icon('counter', 'counter', { ...at(500, 333), w: 300, h: 60, color: '#1C1C1E' });
  const stools = [380, 460, 540].map((x, i) =>
    icon(`stool${i}`, 'stool', { ...at(x, 333 + 30 + 20), color: '#1C1C1E' }),
  );
  const far = icon('far', 'stool', { ...at(900, 600), color: '#1C1C1E' });
  const icons = [track, dolly, cam, stand, flag, lamp('p1', 400), lamp('p2', 500), lamp('p3', 600)];

  it('folds identical lamps, and lists a support with what it carries', () => {
    const rows = elementSections({ icons }, { group: 'all', color: null });
    const of = (g: string) =>
      rows
        .find((s) => s.group === g)
        ?.items.map((e) => [e.item.id.replace(/A+$/, ''), e.refs.length]);
    expect(of('lights')).toEqual([['p1', 3]]);
    expect(of('camera')).toEqual([['acam', 1]]);
    expect(of('grip')).toEqual([['neg', 1]]);
    expect(foldIcons(icons.slice(5), icons).map((f) => f.count)).toEqual([3]);
  });

  it('says a dolly on a track with its length, and counts the seats at a counter', () => {
    expect(supportText(dolly, icons, t2, 70, 'en')).toBe('onTrackLength:dolly,4');
    expect(supportText(dolly, icons, t2)).toBe('onTrack:dolly');
    expect(itemSummary(cam, icons, t2, { scale: 70, locale: 'en' })).toBe(
      '32 mm · onTrackLength:dolly,4',
    );
    const all = [counter, ...stools, far, icon('on', 'stool', { ...at(900, 100), on: counter.id })];
    expect(seatsAround(counter, all)).toBe(4);
  });
});
