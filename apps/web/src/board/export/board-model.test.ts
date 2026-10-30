import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { type BoardSource, collectBoard, exportable } from './board-model.ts';

const base = { z: 'a0', createdBy: 'u1', createdAt: 0, parent: null } as const;
const note = (id: string, x: number, extra: Partial<Element> = {}): Element =>
  ({ ...base, id, type: 'note', x, y: 0, w: 200, ...extra }) as Element;

function source(elements: Element[]): BoardSource {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const columns = new Map<string, Element[]>();
  for (const el of elements) {
    if (el.type === 'column' || el.type === 'scene') {
      columns.set(
        el.id,
        elements.filter((e) => e.parent === el.id),
      );
    }
  }
  return {
    byId,
    canvas: elements.filter((e) => e.parent === null),
    columns,
    heightOf: (el) => el.h ?? 100,
  };
}

const team = { audience: 'team', hideGuestHidden: false } as const;
const client = { audience: 'client', hideGuestHidden: true } as const;

describe('exportable', () => {
  const frame = {
    ...base,
    id: 'frame0001',
    type: 'frame',
    x: 0,
    y: 0,
    w: 240,
    action: 'Il treno entra',
    notes: 'Solo per la regia',
    status: 'retake',
    tags: ['interno'],
  } as Element;

  it('keeps every field for the team', () => {
    expect(exportable(frame, () => frame, team)).toBe(frame);
  });

  it('keeps only what guests see for clients', () => {
    const out = exportable(frame, () => frame, client);
    expect(out).toMatchObject({ id: 'frame0001', action: 'Il treno entra' });
    expect(out).not.toHaveProperty('notes');
    expect(out).not.toHaveProperty('status');
    expect(out).not.toHaveProperty('tags');
    expect(out?.createdBy).toBeNull();
  });

  it('leaves out hidden cards and everything inside a hidden container', () => {
    const column = {
      ...base,
      id: 'column01',
      type: 'column',
      x: 0,
      y: 0,
      w: 260,
      title: 'Cast',
      guestHidden: true,
    } as Element;
    const child = note('note0001', 0, { parent: 'column01' });
    const lookup = (id: string) =>
      id === 'column01' ? column : id === 'note0001' ? child : undefined;
    expect(exportable(child, lookup, client)).toBeNull();
    expect(exportable(child, lookup, team)).toBe(child);
    expect(exportable(child, lookup, { audience: 'team', hideGuestHidden: true })).toBeNull();
  });
});

describe('collectBoard', () => {
  const elements = [
    note('visible1', 0),
    note('hidden01', 300, { guestHidden: true }),
    note('farAway1', 5000),
  ];

  it('takes every card of the board and pads the region around them', () => {
    const { items, region } = collectBoard(source(elements), { kind: 'board' }, team);
    expect(items.map((p) => p.el.id)).toEqual(['visible1', 'hidden01', 'farAway1']);
    expect(region).toEqual({ x: -24, y: -24, w: 5248, h: 148 });
  });

  it('drops cards hidden from guests when asked', () => {
    const { items } = collectBoard(source(elements), { kind: 'board' }, client);
    expect(items.map((p) => p.el.id)).toEqual(['visible1', 'farAway1']);
  });

  it('keeps only the selection, with the container of a selected nested card', () => {
    const column = {
      ...base,
      id: 'column01',
      type: 'column',
      x: 0,
      y: 400,
      w: 260,
      title: 'Cast',
    } as Element;
    const child = note('inside01', 0, { parent: 'column01' });
    const { items } = collectBoard(
      source([...elements, column, child]),
      { kind: 'selection', ids: new Set(['farAway1', 'inside01']) },
      team,
    );
    expect(items.map((p) => p.el.id)).toEqual(['farAway1', 'column01']);
    expect(items[1]?.children?.map((p) => p.el.id)).toEqual(['inside01']);
  });

  it('keeps the visible area as the region and the cards that touch it', () => {
    const rect = { x: -50, y: -50, w: 400, h: 300 };
    const { items, region } = collectBoard(source(elements), { kind: 'visible', rect }, team);
    expect(items.map((p) => p.el.id)).toEqual(['visible1', 'hidden01']);
    expect(region).toBe(rect);
  });

  it('restacks a column without the cards left out', () => {
    const column = {
      ...base,
      id: 'column01',
      type: 'column',
      x: 0,
      y: 0,
      w: 260,
      title: 'Cast',
    } as Element;
    const a = note('childAAA', 0, { parent: 'column01', z: 'a0', h: 50 } as Partial<Element>);
    const b = note('childBBB', 0, {
      parent: 'column01',
      z: 'a1',
      h: 50,
      guestHidden: true,
    } as Partial<Element>);
    const c = note('childCCC', 0, { parent: 'column01', z: 'a2', h: 50 } as Partial<Element>);
    const { items } = collectBoard(source([column, a, b, c]), { kind: 'board' }, client);
    const kids = items[0]?.children ?? [];
    expect(kids.map((p) => p.el.id)).toEqual(['childAAA', 'childCCC']);
    expect((kids[1]?.y ?? 0) - (kids[0]?.y ?? 0)).toBe(58);
  });

  it('drops an arrow whose card is left out', () => {
    const arrow = {
      ...base,
      id: 'arrow001',
      type: 'arrow',
      x: 0,
      y: 0,
      w: 300,
      h: 10,
      from: { elementId: 'visible1', x: 0, y: 0 },
      to: { elementId: 'hidden01', x: 300, y: 0 },
    } as Element;
    expect(
      collectBoard(source([...elements, arrow]), { kind: 'board' }, team).items.map((p) => p.el.id),
    ).toContain('arrow001');
    expect(
      collectBoard(source([...elements, arrow]), { kind: 'board' }, client).items.map(
        (p) => p.el.id,
      ),
    ).not.toContain('arrow001');
  });
});
