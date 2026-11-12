// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { seatsAround, selectionMix } from './elements.ts';

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

it('sums up a selection by layer', () => {
  expect(selectionMix(plan.icons.slice(0, 4), t)).toBe('2 lights, 1 camera, 1 actors');
});

describe('rows as the mockup lists them (decision 0117)', () => {
  // View (500, 333) is grid (2048, 2048); 1 view unit is 4.096 grid units across.
  const at = (vx: number, vy: number) => ({ x: (vx / 1000) * 4096, y: (vy / (1000 / 1.5)) * 4096 });
  const counter = icon('counter', 'counter', { ...at(500, 333), w: 300, h: 60, color: '#1C1C1E' });
  const stools = [380, 460, 540].map((x, i) =>
    icon(`stool${i}`, 'stool', { ...at(x, 333 + 30 + 20), color: '#1C1C1E' }),
  );
  const far = icon('far', 'stool', { ...at(900, 600), color: '#1C1C1E' });

  it('counts the seats at a counter', () => {
    const all = [counter, ...stools, far, icon('on', 'stool', { ...at(900, 100), on: counter.id })];
    expect(seatsAround(counter, all)).toBe(4);
  });
});
