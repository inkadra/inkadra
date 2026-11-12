// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { iconCone, labelAnchor, PLAN_VIEW_H, PLAN_VIEW_W } from './plan.ts';
import { PLAN_LABEL_SIZE } from './plan-labels.ts';
import {
  boundPlanView,
  fitPlanView,
  panPlanBy,
  pinchPlanView,
  planBaseZoom,
  planContentBox,
  planFrame,
  planZoomPercent,
  stepPlanZoom,
  zoomPlanAround,
} from './plan-view.ts';

const area = { w: 876, h: 848 };
const toScreen = (v: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
  x: (p.x - v.x) * v.zoom,
  y: (p.y - v.y) * v.zoom,
});

describe('the view of the plan surface', () => {
  it('calls 100 % the zoom at which the whole drawing fits the area', () => {
    const v = fitPlanView(null, area);
    expect(planZoomPercent(v, area)).toBe(100);
    // The drawing is in the middle.
    const a = toScreen(v, { x: 0, y: 0 });
    const b = toScreen(v, { x: PLAN_VIEW_W, y: PLAN_VIEW_H });
    expect((a.x + b.x) / 2).toBeCloseTo(area.w / 2);
    expect((a.y + b.y) / 2).toBeCloseTo(area.h / 2);
  });

  it('fits a room in the middle of what the bars leave, closer than the whole drawing', () => {
    const room = { x: 160, y: 200, w: 560, h: 440 };
    const insets = { top: 0, right: 0, bottom: 72, left: 0 };
    const v = fitPlanView(room, area, insets);
    expect(v.zoom).toBeGreaterThan(planBaseZoom(area));
    const a = toScreen(v, { x: room.x, y: room.y });
    const b = toScreen(v, { x: room.x + room.w, y: room.y + room.h });
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(area.w);
    expect(b.y).toBeLessThanOrEqual(area.h - insets.bottom);
    expect((a.y + b.y) / 2).toBeCloseTo((area.h - insets.bottom) / 2);
  });

  it('never fits one small icon closer than 250 %', () => {
    const v = fitPlanView({ x: 500, y: 300, w: 10, h: 10 }, area);
    expect(planZoomPercent(v, area)).toBe(250);
  });

  it('zooms around the pointer: the point under it stays under it', () => {
    const v = fitPlanView(null, area);
    const pointer = { x: 600, y: 300 };
    const under = { x: pointer.x / v.zoom + v.x, y: pointer.y / v.zoom + v.y };
    const next = zoomPlanAround(v, area, v.zoom * 2, pointer);
    expect(planZoomPercent(next, area)).toBe(200);
    const after = toScreen(next, under);
    expect(after.x).toBeCloseTo(pointer.x);
    expect(after.y).toBeCloseTo(pointer.y);
  });

  it('keeps the zoom between 25 % and 800 %', () => {
    const v = fitPlanView(null, area);
    expect(planZoomPercent(zoomPlanAround(v, area, v.zoom * 100, { x: 0, y: 0 }), area)).toBe(800);
    expect(planZoomPercent(zoomPlanAround(v, area, v.zoom / 100, { x: 0, y: 0 }), area)).toBe(25);
  });

  it('steps the buttons through the levels round the middle', () => {
    const v = fitPlanView(null, area);
    const inOnce = stepPlanZoom(v, area, 1);
    expect(planZoomPercent(inOnce, area)).toBe(150);
    expect(planZoomPercent(stepPlanZoom(inOnce, area, -1), area)).toBe(100);
    expect(planZoomPercent(stepPlanZoom(v, area, -1), area)).toBe(75);
    // From an odd level the next step is the next round one.
    const odd = zoomPlanAround(v, area, v.zoom * 1.3, { x: 0, y: 0 });
    expect(planZoomPercent(stepPlanZoom(odd, area, 1), area)).toBe(150);
    expect(planZoomPercent(stepPlanZoom(odd, area, -1), area)).toBe(100);
    // The middle of the area stays where it was.
    const mid = { x: area.w / 2 / v.zoom + v.x, y: area.h / 2 / v.zoom + v.y };
    const m = toScreen(inOnce, mid);
    expect(m.x).toBeCloseTo(area.w / 2);
    expect(m.y).toBeCloseTo(area.h / 2);
  });

  it('pans by pixels and never loses the drawing', () => {
    const v = fitPlanView(null, area);
    const moved = panPlanBy(v, area, 100, -40);
    expect(toScreen(moved, { x: 0, y: 0 }).x).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).x + 100);
    expect(toScreen(moved, { x: 0, y: 0 }).y).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).y - 40);
    const far = panPlanBy(v, area, 100_000, 100_000);
    // At least 64 px of the drawing still show at the far edge.
    expect(toScreen(far, { x: 0, y: 0 }).x).toBeLessThanOrEqual(area.w - 64 + 0.001);
    expect(toScreen(far, { x: 0, y: 0 }).y).toBeLessThanOrEqual(area.h - 64 + 0.001);
    const back = boundPlanView({ ...v, x: -100_000, y: -100_000 }, area);
    expect(toScreen(back, { x: PLAN_VIEW_W, y: PLAN_VIEW_H }).x).toBeGreaterThanOrEqual(63.999);
  });

  it('pinches: the point under the fingers follows their middle, zoomed by their spread', () => {
    const v = fitPlanView(null, area);
    const from = [
      { x: 300, y: 400 },
      { x: 400, y: 400 },
    ] as const;
    const to = [
      { x: 250, y: 450 },
      { x: 450, y: 450 },
    ] as const;
    const under = { x: 350 / v.zoom + v.x, y: 400 / v.zoom + v.y };
    const next = pinchPlanView(v, area, from, to);
    expect(next.zoom).toBeCloseTo(v.zoom * 2);
    const after = toScreen(next, under);
    expect(after.x).toBeCloseTo(350);
    expect(after.y).toBeCloseTo(450);
  });

  it('frames what is on the plan: items, walls and the background', () => {
    expect(planContentBox({})).toBeNull();
    const icon = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: 2048, y: 2048 };
    const box = planContentBox({ icons: [icon as PlanIcon] });
    expect(box?.x).toBeGreaterThan(400);
    expect(box?.x).toBeLessThan(500);
    const walls = planContentBox({
      walls: [{ id: 'wAAAAAAAAAAAA', points: [0, 0, 2048, 0, 2048, 4096], thickness: 10 }],
    });
    expect(walls).toEqual({ x: -5, y: -5, w: 510, h: PLAN_VIEW_H + 10 });
    const placed = planContentBox({
      background: { assetId: 'pic', x: -200, y: -100, w: 400, h: 200 },
    });
    expect(placed).toEqual({ x: -200, y: -100, w: 400, h: 200 });
    expect(planContentBox({ background: { assetId: 'pic', hidden: true } })).toBeNull();
  });

  it("frames what is drawn in the plan's shape, beyond the old extent too", () => {
    expect(planFrame({})).toEqual({ x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H });
    const far = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: -2048, y: 6000 };
    const near = { ...far, id: 'bAAAAAAAAAAAA', x: 2048, y: 2048 };
    const content = planContentBox({ icons: [far, near] as PlanIcon[] });
    const f = planFrame({ icons: [far, near] as PlanIcon[] });
    expect(f.w / f.h).toBeCloseTo(1.5);
    expect(f.x).toBeLessThan(content?.x ?? 0);
    expect(f.y).toBeLessThan(content?.y ?? 0);
    expect(f.x + f.w).toBeGreaterThan((content?.x ?? 0) + (content?.w ?? 0));
    expect(f.y + f.h).toBeGreaterThan((content?.y ?? 0) + (content?.h ?? 0));
    // One small item: never narrower than 400 view units, centred on it.
    const one = planFrame({ icons: [near] as PlanIcon[] });
    expect(one.w).toBe(400);
    const box = planContentBox({ icons: [near] as PlanIcon[] });
    expect(one.x + one.w / 2).toBeCloseTo((box?.x ?? 0) + (box?.w ?? 0) / 2);
    // The background counts only when asked.
    const bg = { assetId: 'pic', x: -900, y: -900, w: 100, h: 100 };
    expect(planFrame({ icons: [near] as PlanIcon[], background: bg }, false)).toEqual(one);
    expect(planFrame({ icons: [near] as PlanIcon[], background: bg }).x).toBeLessThan(-900);
  });

  it('fits a phone by its width, from the top', () => {
    const phone = { w: 390, h: 728 };
    const room = { x: 100, y: 100, w: 600, h: 500 };
    const v = fitPlanView(room, phone, { top: 48, right: 0, bottom: 0, left: 0 }, true);
    expect(v.zoom).toBeCloseTo((390 - 48) / 600);
    expect(toScreen(v, { x: room.x, y: room.y }).y).toBeCloseTo(48 + 24);
  });

  it('lets everything within the plan\'s reach be seen: Fit and panning are not held to the extent', () => {
    // An item far out, as the reach allows (review of #615, 1).
    const far = { x: 2500, y: 1500, w: 40, h: 40 };
    const v = fitPlanView(far, area);
    const c = toScreen(v, { x: far.x + far.w / 2, y: far.y + far.h / 2 });
    expect(c.x).toBeCloseTo(area.w / 2);
    expect(c.y).toBeCloseTo(area.h / 2);
    // And a pan from the plan reaches it at 100 %.
    const start = fitPlanView(null, area);
    const there = panPlanBy(start, area, -(2500 * start.zoom), -(1500 * start.zoom));
    expect(toScreen(there, { x: 2500, y: 1500 }).x).toBeLessThan(area.w);
    expect(toScreen(there, { x: 2500, y: 1500 }).y).toBeLessThan(area.h);
  });

  it('frames only what is drawn: hidden layers and a caller\'s hidden list are left out', () => {
    // Review of #615, 2: a hidden item far away must not shrink the rest into a corner.
    const seen = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: 2048, y: 2048 };
    const away = { id: 'bAAAAAAAAAAAA', kind: 'cob', color: '#EDD963', x: 20000, y: 20000 };
    const icons = [seen, away] as PlanIcon[];
    const alone = planFrame({ icons: [seen] as PlanIcon[] });
    expect(planFrame({ icons, hiddenLayers: ['lights'] })).toEqual(alone);
    expect(planFrame({ icons }, true, ['lights'])).toEqual(alone);
    // Nothing drawn: the standard extent.
    expect(planFrame({ icons, hiddenLayers: ['lights', 'set'] })).toEqual({
      x: 0,
      y: 0,
      w: PLAN_VIEW_W,
      h: PLAN_VIEW_H,
    });
  });

  it('frames what is drawn for an item: labels, a light\'s second line, beams, blocking', () => {
    // Review of #615, 3: nothing drawn may be cut at the edge of the card or the sheet.
    const key = {
      id: 'aAAAAAAAAAAAA',
      kind: 'cob',
      color: '#EDD963',
      x: 2048,
      y: 2048,
      label: 'Key light with a long name',
      kelvin: 3200,
      intensity: 0.8,
      rotation: 90,
    } as PlanIcon;
    const box = planContentBox({ icons: [key] }) as { x: number; y: number; w: number; h: number };
    const anchor = labelAnchor(key);
    // The second line, 12 + 2 + 11 units under the label's baseline.
    expect(box.y + box.h).toBeGreaterThanOrEqual(anchor.y + PLAN_LABEL_SIZE + 2);
    // The beam, pointing down, reaches its default length.
    const cone = iconCone(key);
    for (const p of cone?.points ?? []) expect(box.y + box.h).toBeGreaterThanOrEqual(p.y - 0.5);
    // A label wider than the icon.
    expect(box.w).toBeGreaterThan(PLAN_LABEL_SIZE * 0.5 * 'Key light with a long name'.length);
    // Earlier positions of a person and the way between them.
    const walker = {
      id: 'cAAAAAAAAAAAA',
      kind: 'actor',
      color: '#7AD689',
      x: 2048,
      y: 2048,
      steps: [{ x: 0, y: 0 }],
    } as PlanIcon;
    const moved = planContentBox({ icons: [walker] }) as { x: number; y: number };
    expect(moved.x).toBeLessThan(0);
    expect(moved.y).toBeLessThan(0);
  });
});
