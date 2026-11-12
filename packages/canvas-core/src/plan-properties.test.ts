// SPDX-License-Identifier: MPL-2.0
import { PLAN_ICON_KINDS, type PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_COLOURS,
  iconColor,
  NOTE_COLOR,
  PLAN_COLORS,
  PLAN_INK,
  planToken,
} from './plan-draw.ts';
import {
  GELS,
  KELVIN_RANGE,
  KELVINS,
  LENSES,
  measureValue,
  seatsAround,
  seatsLine,
  selectionMix,
} from './plan-properties.ts';
import { english } from './plan-words.fixture.ts';
import { PLAN_WORDS_EN } from './plan-words.ts';

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 1000,
  y: 1000,
  ...extra,
});

describe('the plan colours (decision 0062)', () => {
  it('are unique hex codes and tokens, ink first', () => {
    const hexes = PLAN_COLORS.map((c) => c.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
    expect(new Set(PLAN_COLORS.map((c) => c.token)).size).toBe(PLAN_COLORS.length);
    expect(new Set(PLAN_COLORS.map((c) => c.name)).size).toBe(PLAN_COLORS.length);
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(PLAN_INK).toBe('#1C1C1E');
    expect(CHARACTER_COLOURS).toEqual(hexes.slice(1));
  });

  it('each have a name in the shared words', () => {
    const names: Record<string, string> = PLAN_WORDS_EN.board.plan.colors;
    expect(PLAN_COLORS.filter((c) => !names[c.name]).map((c) => c.name)).toEqual([]);
    expect(Object.keys(names).sort()).toEqual(PLAN_COLORS.map((c) => c.name).sort());
  });

  it('give every kind and annotations a first colour of the palette', () => {
    for (const kind of PLAN_ICON_KINDS) expect(planToken(iconColor(kind))).not.toBeNull();
    expect(iconColor('fresnel')).toBe('#EDD963');
    expect(iconColor('camera')).toBe('#9DB8F2');
    expect(iconColor('actor')).toBe('#B897F0');
    expect(planToken(NOTE_COLOR)).toBe('tag-green');
  });

  it('read a colour outside the palette as no token', () => {
    expect(planToken('#1C1C1E')).toBe('text-secondary');
    expect(planToken('#123456')).toBeNull();
  });
});

describe('the Properties choices', () => {
  it('offer the presets of the web', () => {
    expect(LENSES).toEqual([24, 35, 50, 85]);
    expect(KELVINS).toEqual([3200, 4300, 5600]);
    expect(KELVIN_RANGE).toEqual([2000, 10000]);
    for (const k of KELVINS) expect(k >= KELVIN_RANGE[0] && k <= KELVIN_RANGE[1]).toBe(true);
    expect(new Set(GELS).size).toBe(GELS.length);
  });

  it('read a length typed in either way and refuse anything else', () => {
    expect(measureValue('6,20')).toBe('6.2');
    expect(measureValue(' 3.5 ')).toBe('3.5');
    for (const wrong of ['0', '-1', '', 'tre', '100000']) expect(measureValue(wrong)).toBeNull();
  });

  it('sum up a selection by layer, in the shared words', () => {
    const key = icon('key', 'cob', { label: 'Key', watts: 300, stand: 'cstand' });
    const items = [
      key,
      icon('box', 'softbox', { on: key.id }),
      icon('cam', 'camera', { color: '#9DB8F2', lens: 32 }),
      icon('anna', 'actor', { color: '#B897F0', pose: 'seated' }),
    ];
    expect(selectionMix(items, english)).toBe('2 lights, 1 camera item, 1 person');
  });
});

describe('the seats at a counter (decision 0117)', () => {
  // View (500, 333) is grid (2048, 2048); 1 view unit is 4.096 grid units across.
  const at = (vx: number, vy: number) => ({ x: (vx / 1000) * 4096, y: (vy / (1000 / 1.5)) * 4096 });
  const counter = icon('counter', 'counter', { ...at(500, 333), w: 300, h: 60, color: '#1C1C1E' });
  const stools = [380, 460, 540].map((x, i) =>
    icon(`stool${i}`, 'stool', { ...at(x, 333 + 30 + 20), color: '#1C1C1E' }),
  );
  const far = icon('far', 'stool', { ...at(900, 600), color: '#1C1C1E' });
  const on = icon('on', 'stool', { ...at(900, 100), on: counter.id });

  it('counts the seats attached or standing against it', () => {
    expect(seatsAround(counter, [counter, ...stools, far, on])).toBe(4);
  });

  it('names them when they are all of one kind', () => {
    expect(seatsLine(counter, [counter, ...stools, far, on])).toEqual({ count: 4, kind: 'stool' });
    const chair = icon('chair', 'chair', { ...at(500, 333 - 30 - 20) });
    expect(seatsLine(counter, [counter, ...stools, chair])).toEqual({ count: 4, kind: null });
  });
});
