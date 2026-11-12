// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, MAX_PLAN_ICONS, type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import {
  addPlanIcon,
  addVariant,
  iconCentre,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanItem,
  variantView,
} from './plan.ts';
import { modifiersOn } from './plan-attach.ts';
import {
  dropWrites,
  ensurePlanScale,
  freshPlanIcon,
  hiddenToggle,
  lockedLayersToggle,
  lockWrites,
  moveToPlanLayer,
  nudgeWrites,
  placePlanIcon,
  planDropTarget,
  planEdit,
  planIconsFull,
  planItemOwner,
  planLayerOwner,
  planSnapAt,
  removeUnlockedItems,
  removeUnlockedWalls,
  restackWrites,
  rotateWrites,
  writePlanItems,
} from './plan-editing.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';
import { addPlanWall } from './plan-walls.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const LOCAL = 'test';
const g = (v: number, w: number) => Math.round((v / w) * STROKE_GRID);
const at = (x: number, y: number) => ({ x: g(x, PLAN_VIEW_W), y: g(y, PLAN_VIEW_H) });
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const iconOf = (doc: Y.Doc, planId: string, id: string) =>
  planOf(doc, planId).icons?.find((i) => i.id === id) as PlanIcon;
const white = { color: () => '#FFFFFF' };

function plan() {
  const doc = createBoardDoc(boardId);
  const el = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const add = (kind: PlanIcon['kind'], x: number, y: number, extra: Partial<PlanIcon> = {}) =>
    addPlanIcon(doc, el.id, {
      kind,
      color: '#1C1C1E',
      w: 60,
      h: 60,
      ...at(x, y),
      ...extra,
    }) as string;
  const edit = () => planEdit(planOf(doc, el.id));
  return { doc, id: el.id, add, edit };
}

/** A base with a table on Set, and a setup of it with a camera of its own. */
function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const table = addPlanIcon(doc, base, {
    kind: 'table',
    color: '#1C1C1E',
    ...at(400, 300),
  }) as string;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const camera = addPlanIcon(doc, sera, {
    kind: 'camera',
    color: '#1C1C1E',
    ...at(200, 200),
  }) as string;
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, table, camera, edit };
}

describe('who owns an item and where a write goes', () => {
  it('on a base, everything is the plan edited', () => {
    const p = plan();
    const chair = p.add('chair', 400, 300);
    expect(planItemOwner(p.edit(), chair)).toBe(p.id);
    expect(planLayerOwner(p.edit(), 'set')).toBe(p.id);
    expect(planLayerOwner(p.edit(), 'camera')).toBe(p.id);
  });

  it("on a setup, Set is the base's and the setup's own items are the setup's", () => {
    const s = setup();
    const edit = s.edit();
    expect(planItemOwner(edit, s.table)).toBe(s.base);
    expect(planItemOwner(edit, s.camera)).toBe(s.sera);
    expect(planLayerOwner(edit, 'set')).toBe(s.base);
    expect(planLayerOwner(edit, 'camera')).toBe(s.sera);
    // The setup draws the base's Set under its own.
    expect(edit.drawn.icons?.map((i) => i.id).sort()).toEqual([s.table, s.camera].sort());
  });

  it('writes each item where it lives, only what changed', () => {
    const s = setup();
    const edit = s.edit();
    const table = edit.drawn.icons?.find((i) => i.id === s.table) as PlanIcon;
    const camera = edit.drawn.icons?.find((i) => i.id === s.camera) as PlanIcon;
    writePlanItems(
      s.doc,
      edit,
      [
        { ...table, label: 'Desk' },
        { ...camera, label: 'A' },
      ],
      LOCAL,
    );
    expect(iconOf(s.doc, s.base, s.table).label).toBe('Desk');
    expect(iconOf(s.doc, s.sera, s.camera).label).toBe('A');
    expect(planOf(s.doc, s.sera).icons?.map((i) => i.id)).toEqual([s.camera]);
    writePlanItems(s.doc, s.edit(), [{ ...table, label: 'Desk', x: table.x + 10 }], LOCAL);
    expect(iconOf(s.doc, s.base, s.table)).toMatchObject({ label: 'Desk', x: table.x + 10 });
  });
});

describe('remove', () => {
  it('removes from the plan and its base; items locked on their own stay', () => {
    const s = setup();
    writePlanItems(s.doc, s.edit(), [{ ...iconOf(s.doc, s.base, s.table), locked: true }], LOCAL);
    const gone = removeUnlockedItems(s.doc, s.edit(), [s.table, s.camera], LOCAL);
    expect(gone).toEqual([s.camera]);
    expect(planOf(s.doc, s.sera).icons ?? []).toEqual([]);
    expect(planOf(s.doc, s.base).icons?.map((i) => i.id)).toEqual([s.table]);
    expect(removeUnlockedItems(s.doc, s.edit(), [s.table], LOCAL)).toEqual([]);
  });

  it("removes walls from the base's Set; a wall locked on its own stays", () => {
    const s = setup();
    const a = addPlanWall(s.doc, s.base, { points: [0, 0, 100, 0], thickness: 10 }) as string;
    const b = addPlanWall(s.doc, s.base, {
      points: [0, 0, 0, 100],
      thickness: 10,
      locked: true,
    }) as string;
    expect(removeUnlockedWalls(s.doc, s.edit(), [a, b], LOCAL)).toEqual([a]);
    expect(planOf(s.doc, s.base).walls?.map((w) => w.id)).toEqual([b]);
  });
});

describe('lock, restack, layers', () => {
  it('locks all when one is unlocked, and unlocks when all are locked', () => {
    const items = [{ id: 'a', locked: true }, { id: 'b' }] as unknown as PlanItem[];
    expect(lockWrites(items).map((i) => i.locked)).toEqual([true, true]);
    expect(lockWrites(lockWrites(items)).map((i) => i.locked)).toEqual([undefined, undefined]);
  });

  it('restacks icons only, the tier kept between 0 and 5', () => {
    const p = plan();
    p.add('chair', 400, 300, { tier: 5 });
    p.add('sofa', 600, 300, { tier: 0 });
    const icons = p.edit().drawn.icons ?? [];
    const stroke = { id: 's', points: '' } as unknown as PlanItem;
    expect(restackWrites([...icons, stroke], 1).map((i) => i.tier)).toEqual([5, 1]);
    expect(restackWrites(icons, -1).map((i) => i.tier)).toEqual([4, 0]);
  });

  it("moves a setup's item to Set into the base, in one transaction; a locked one stays", () => {
    const s = setup();
    const locked = addPlanIcon(s.doc, s.sera, {
      kind: 'chair',
      color: '#1C1C1E',
      ...at(600, 300),
      layer: 'actors',
      locked: true,
    }) as string;
    const drawn = s.edit().drawn.icons ?? [];
    let transactions = 0;
    s.doc.on('afterTransaction', () => transactions++);
    moveToPlanLayer(
      s.doc,
      s.edit(),
      drawn.filter((i) => i.id !== s.table),
      'set',
      LOCAL,
    );
    expect(transactions).toBe(1);
    expect(planOf(s.doc, s.base).icons?.map((i) => i.id)).toEqual([s.table, s.camera]);
    expect(iconOf(s.doc, s.base, s.camera).layer).toBe('set');
    expect(planOf(s.doc, s.sera).icons?.map((i) => i.id)).toEqual([locked]);
    expect(
      variantView(planOf(s.doc, s.sera), planOf(s.doc, s.base)).icons?.map((i) => i.id),
    ).toContain(s.camera);
  });

  it("moves an item to another layer on a base, the kind's own layer stored as none", () => {
    const p = plan();
    const table = p.add('table', 400, 300);
    moveToPlanLayer(p.doc, p.edit(), p.edit().drawn.icons ?? [], 'actors', LOCAL);
    expect(iconOf(p.doc, p.id, table).layer).toBe('actors');
    moveToPlanLayer(p.doc, p.edit(), p.edit().drawn.icons ?? [], 'set', LOCAL);
    expect(iconOf(p.doc, p.id, table).layer).toBeUndefined();
  });

  it("hides a setup's layer in the document, a base's and Grip for the person", () => {
    const s = setup();
    const sera = planOf(s.doc, s.sera);
    expect(hiddenToggle(sera, new Set(), 'set')).toEqual({
      for: 'plan',
      patch: { hiddenLayers: ['set'] },
    });
    expect(hiddenToggle({ ...sera, hiddenLayers: ['set'] }, new Set(['set']), 'set')).toEqual({
      for: 'plan',
      patch: { hiddenLayers: undefined },
    });
    expect(hiddenToggle(sera, new Set(), 'grip')).toEqual({ for: 'person', name: 'grip' });
    expect(hiddenToggle(planOf(s.doc, s.base), new Set(), 'set')).toEqual({
      for: 'person',
      name: 'set',
    });
  });

  it('locks and unlocks a layer', () => {
    expect(lockedLayersToggle({}, 'set')).toEqual({ lockedLayers: ['set'] });
    expect(lockedLayersToggle({ lockedLayers: ['set', 'camera'] }, 'set')).toEqual({
      lockedLayers: ['camera'],
    });
    expect(lockedLayersToggle({ lockedLayers: ['set'] }, 'set')).toEqual({
      lockedLayers: undefined,
    });
  });

  it("gives the base the nominal scale once, a setup's included", () => {
    const s = setup();
    ensurePlanScale(s.doc, s.edit(), LOCAL);
    expect(planOf(s.doc, s.base)).toMatchObject({ scale: NOMINAL_SCALE, grid: '0.5' });
    expect(planOf(s.doc, s.sera).scale).toBeUndefined();
    let writes = 0;
    s.doc.on('afterTransaction', () => writes++);
    ensurePlanScale(s.doc, s.edit(), LOCAL);
    expect(writes).toBe(0);
  });
});

describe('nudge and rotate', () => {
  /** A sofa with an actor on it, a stool, and a chair locked on its own with an actor on it. */
  function seated() {
    const p = plan();
    const sofa = p.add('sofa', 400, 300, { w: 180, h: 80 });
    const stool = p.add('stool', 700, 300);
    const chair = p.add('chair', 300, 500, { locked: true });
    const actor = placePlanIcon(
      p.doc,
      p.edit(),
      'actor',
      { x: 0.1, y: 0.1 },
      { ...white, on: sofa },
      LOCAL,
    ) as string;
    const sitter = placePlanIcon(
      p.doc,
      p.edit(),
      'actor',
      { x: 0.9, y: 0.9 },
      { ...white, on: chair },
      LOCAL,
    ) as string;
    return { ...p, sofa, stool, chair, actor, sitter };
  }
  const icons = (p: ReturnType<typeof seated>) => p.edit().drawn.icons ?? [];
  const pick = (p: ReturnType<typeof seated>, ...ids: string[]) =>
    icons(p).filter((i) => ids.includes(i.id));

  it('moves several items with what sits on them', () => {
    const p = seated();
    const before = iconOf(p.doc, p.id, p.actor);
    writePlanItems(
      p.doc,
      p.edit(),
      nudgeWrites(p.edit(), pick(p, p.sofa, p.stool), { x: 10, y: 0 }),
      LOCAL,
    );
    const after = iconOf(p.doc, p.id, p.actor);
    expect(after.on).toBe(p.sofa);
    expect(iconCentre(after).x).toBeCloseTo(iconCentre(before).x + 10, 0);
  });

  it('turns several items as one piece, with what sits on them', () => {
    const p = seated();
    const before = iconOf(p.doc, p.id, p.actor);
    const writes = rotateWrites(p.edit(), pick(p, p.sofa, p.stool), 90);
    expect(writes.map((i) => i.id).sort()).toEqual([p.sofa, p.stool, p.actor].sort());
    writePlanItems(p.doc, p.edit(), writes, LOCAL);
    const after = iconOf(p.doc, p.id, p.actor);
    expect(after.rotation ?? 0).toBe(((before.rotation ?? 0) + 90) % 360);
    expect(iconCentre(after)).not.toEqual(iconCentre(before));
  });

  it('turns a base with what is on it, and a lone item on its own', () => {
    const p = seated();
    expect(
      rotateWrites(p.edit(), pick(p, p.sofa), 45)
        .map((i) => i.id)
        .sort(),
    ).toEqual([p.sofa, p.actor].sort());
    expect(rotateWrites(p.edit(), pick(p, p.stool), 45).map((i) => i.id)).toEqual([p.stool]);
    expect(rotateWrites(p.edit(), [], 45)).toEqual([]);
  });

  it('moves nothing of a locked base, what sits on it included (decision 0114)', () => {
    const p = seated();
    const chair = iconOf(p.doc, p.id, p.chair);
    const sitter = iconOf(p.doc, p.id, p.sitter);
    expect(sitter.on).toBe(p.chair);
    writePlanItems(
      p.doc,
      p.edit(),
      nudgeWrites(p.edit(), pick(p, p.chair), { x: 20, y: 0 }),
      LOCAL,
    );
    writePlanItems(p.doc, p.edit(), rotateWrites(p.edit(), pick(p, p.chair), 90), LOCAL);
    expect(iconOf(p.doc, p.id, p.chair)).toEqual(chair);
    expect(iconOf(p.doc, p.id, p.sitter)).toEqual(sitter);
  });
});

describe('placing an icon', () => {
  it("places a fresh icon on the grid, at its kind's size, on the layer worked on", () => {
    const p = plan();
    const { layer, icon } = freshPlanIcon(
      p.edit(),
      'table',
      { x: 0.5, y: 0.25 },
      {
        layer: 'actors',
        color: (k) => `colour of ${k}`,
      },
    );
    expect(layer).toBe('actors');
    expect(icon).toMatchObject({
      kind: 'table',
      color: 'colour of table',
      x: STROKE_GRID / 2,
      y: STROKE_GRID / 4,
      layer: 'actors',
    });
    expect(freshPlanIcon(p.edit(), 'table', { x: 0, y: 0 }, white).icon.layer).toBeUndefined();
  });

  it("places on a setup's Set into the base", () => {
    const s = setup();
    const id = placePlanIcon(s.doc, s.edit(), 'sofa', { x: 0.5, y: 0.5 }, white, LOCAL);
    expect(planOf(s.doc, s.base).icons?.map((i) => i.id)).toContain(id);
    const cam = placePlanIcon(s.doc, s.edit(), 'camera', { x: 0.5, y: 0.5 }, white, LOCAL);
    expect(planOf(s.doc, s.sera).icons?.map((i) => i.id)).toContain(cam);
  });

  it('places a project-kit light with two modifiers in one transaction', () => {
    const p = plan();
    let transactions = 0;
    p.doc.on('afterTransaction', () => transactions++);
    const id = placePlanIcon(
      p.doc,
      p.edit(),
      'cob',
      { x: 0.5, y: 0.5 },
      { ...white, fields: { watts: 300 }, modifiers: ['softbox', 'grid'] },
      LOCAL,
    );
    expect(transactions).toBe(1);
    const icons = planOf(p.doc, p.id).icons ?? [];
    expect(icons.map((i) => [i.kind, i.on])).toEqual([
      ['cob', undefined],
      ['softbox', id],
      ['grid', id],
    ]);
    expect(icons[0]?.watts).toBe(300);
    expect(modifiersOn(icons[0] as PlanIcon, icons).map((i) => i.kind)).toEqual([
      'softbox',
      'grid',
    ]);
  });

  it('places nothing when the plan is full', () => {
    const p = plan();
    p.doc.transact(() => {
      for (let i = 0; i < MAX_PLAN_ICONS; i++) p.add('chair', 10, 10);
    });
    expect(planIconsFull(p.edit())).toBe(true);
    expect(placePlanIcon(p.doc, p.edit(), 'chair', { x: 0.5, y: 0.5 }, white, LOCAL)).toBeNull();
    expect(planOf(p.doc, p.id).icons).toHaveLength(MAX_PLAN_ICONS);
  });
});

describe('snapping', () => {
  function sofa() {
    const p = plan();
    const sofa = p.add('sofa', 400, 300, { w: 180, h: 80 });
    const stool = p.add('stool', 700, 300);
    const centre = iconCentre(p.edit().drawn.icons?.[0] as PlanIcon);
    return { ...p, sofa, stool, centre };
  }

  it('never snaps to an icon on a hidden layer', () => {
    const p = sofa();
    expect(planSnapAt(p.edit(), new Set(), { kind: 'actor' }, p.centre)?.id).toBe(p.sofa);
    expect(planSnapAt(p.edit(), new Set(['set']), { kind: 'actor' }, p.centre)).toBeNull();
  });

  it('lands free with snapping off, Alt held, or a kind that never attaches', () => {
    const p = sofa();
    const drop = (kind: PlanIcon['kind'], attach: boolean, alt: boolean) =>
      planDropTarget(p.edit(), new Set(), { kind }, p.centre, { attach, alt })?.id ?? null;
    expect(drop('actor', true, false)).toBe(p.sofa);
    expect(drop('actor', false, false)).toBeNull();
    expect(drop('actor', true, true)).toBeNull();
    expect(drop('table', true, false)).toBeNull();
  });

  it('detaches an icon pulled off its base, attaches one let go on another', () => {
    const p = sofa();
    const actor = placePlanIcon(
      p.doc,
      p.edit(),
      'actor',
      { x: 0.1, y: 0.1 },
      { ...white, on: p.sofa },
      LOCAL,
    ) as string;
    const icons = p.edit().drawn.icons ?? [];
    const item = icons.find((i) => i.id === actor) as PlanIcon;
    const moved = { ...item, x: item.x + 300 };
    const pulled = dropWrites(icons, { item, pulled: true }, [moved]);
    expect(pulled.find((i) => i.id === actor)).toMatchObject({ x: moved.x });
    expect((pulled.find((i) => i.id === actor) as PlanIcon).on).toBeUndefined();
    const landed = dropWrites(icons, { item, pulled: true, target: p.stool }, [moved]);
    expect((landed.find((i) => i.id === actor) as PlanIcon).on).toBe(p.stool);
    // Nothing to snap: what the gesture left is what is written.
    expect(dropWrites(icons, null, [moved])).toEqual([moved]);
    writePlanItems(p.doc, p.edit(), landed, LOCAL, [item]);
    expect(iconOf(p.doc, p.id, actor).on).toBe(p.stool);
  });
});
