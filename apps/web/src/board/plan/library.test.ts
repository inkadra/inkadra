// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { projectKit, projectKitDetail, searchLibrary } from './library.ts';

const NAMES: Record<string, string> = {
  'board.plan.icons.softbox': 'Softbox',
  'board.plan.icons.softlight': 'Soft light',
  'board.plan.synonyms.lantern': 'china ball, soft ball',
  'board.plan.icons.lantern': 'Lantern',
  'board.plan.icons.cob': 'LED COB',
  'board.plan.icons.grid': 'Grid',
  'board.plan.stands.cstand': 'C-stand',
};
const t = ((key: string, o?: { defaultValue?: string; names?: string }) =>
  key === 'board.plan.lib.alsoCalled'
    ? `also ${o?.names}`
    : (NAMES[key] ?? o?.defaultValue ?? key.split('.').at(-1))) as unknown as TFunction;

describe('searchLibrary', () => {
  it('finds names first, then other names, ignoring case and accents', () => {
    const hits = searchLibrary(t, 'SÖFT');
    expect(hits.slice(0, 2).map((h) => h.item)).toEqual(['softlight', 'softbox']);
    const lantern = hits.find((h) => h.item === 'lantern');
    expect(lantern?.by).toBe('synonym');
    expect(lantern?.detail).toBe('also china ball, soft ball');
  });
  it('finds by category and returns nothing for an empty query', () => {
    expect(searchLibrary(t, 'notes').map((h) => h.item)).toEqual([
      'arrow',
      'text',
      'measure',
      'zone',
    ]);
    expect(searchLibrary(t, '  ')).toEqual([]);
  });
});

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 100,
  y: 100,
  ...extra,
});

describe('projectKit', () => {
  it('keeps each configured light and camera once, with modifiers and lenses', () => {
    const key = icon('key', 'cob', { label: 'Key', watts: 300, stand: 'cstand' });
    const plans = [
      { icons: [key, icon('grid', 'grid', { on: key.id }), icon('bare', 'fresnel')] },
      {
        icons: [
          { ...key, id: 'key2AAAAAAAAA', x: 900 },
          icon('grid2', 'grid', { on: 'key2AAAAAAAAA' }),
          icon('cam', 'camera', { label: 'A cam', lens: 50 }),
        ],
      },
      { icons: [icon('cam2', 'camera', { label: 'A cam', lens: 32 }), icon('cam3', 'camera')] },
    ];
    const kit = projectKit(plans);
    expect(kit).toHaveLength(2);
    expect(kit[0]?.modifiers).toEqual(['grid']);
    expect(kit[0]?.icon).toMatchObject({ kind: 'cob', label: 'Key', watts: 300 });
    expect(kit[1]?.lenses).toEqual([32, 50]);
    expect(projectKitDetail(kit[0] as never, t, 'S35')).toBe('LED COB 300 W · Grid · C-stand');
    expect(projectKitDetail(kit[1] as never, t, 'S35')).toBe('S35 · 32, 50 mm');
  });
});
