// SPDX-License-Identifier: AGPL-3.0-only
import { PLAN_VIEW_H, PLAN_VIEW_W } from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import {
  baseZoom,
  boundView,
  fitView,
  panBy,
  pinchView,
  planContentBox,
  stepZoom,
  zoomAround,
  zoomPercent,
} from './view.ts';

const area = { w: 876, h: 848 };
const toScreen = (v: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
  x: (p.x - v.x) * v.zoom,
  y: (p.y - v.y) * v.zoom,
});

describe('the view of the plan surface', () => {
  it('calls 100 % the zoom at which the whole drawing fits the area', () => {
    const v = fitView(null, area);
    expect(zoomPercent(v, area)).toBe(100);
    // The drawing is in the middle.
    const a = toScreen(v, { x: 0, y: 0 });
    const b = toScreen(v, { x: PLAN_VIEW_W, y: PLAN_VIEW_H });
    expect((a.x + b.x) / 2).toBeCloseTo(area.w / 2);
    expect((a.y + b.y) / 2).toBeCloseTo(area.h / 2);
  });

  it('fits a room in the middle of what the bars leave, closer than the whole drawing', () => {
    const room = { x: 160, y: 200, w: 560, h: 440 };
    const insets = { top: 0, right: 0, bottom: 72, left: 0 };
    const v = fitView(room, area, insets);
    expect(v.zoom).toBeGreaterThan(baseZoom(area));
    const a = toScreen(v, { x: room.x, y: room.y });
    const b = toScreen(v, { x: room.x + room.w, y: room.y + room.h });
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(area.w);
    expect(b.y).toBeLessThanOrEqual(area.h - insets.bottom);
    expect((a.y + b.y) / 2).toBeCloseTo((area.h - insets.bottom) / 2);
  });

  it('never fits one small icon closer than 250 %', () => {
    const v = fitView({ x: 500, y: 300, w: 10, h: 10 }, area);
    expect(zoomPercent(v, area)).toBe(250);
  });

  it('zooms around the pointer: the point under it stays under it', () => {
    const v = fitView(null, area);
    const pointer = { x: 600, y: 300 };
    const under = { x: pointer.x / v.zoom + v.x, y: pointer.y / v.zoom + v.y };
    const next = zoomAround(v, area, v.zoom * 2, pointer);
    expect(zoomPercent(next, area)).toBe(200);
    const after = toScreen(next, under);
    expect(after.x).toBeCloseTo(pointer.x);
    expect(after.y).toBeCloseTo(pointer.y);
  });

  it('keeps the zoom between 25 % and 800 %', () => {
    const v = fitView(null, area);
    expect(zoomPercent(zoomAround(v, area, v.zoom * 100, { x: 0, y: 0 }), area)).toBe(800);
    expect(zoomPercent(zoomAround(v, area, v.zoom / 100, { x: 0, y: 0 }), area)).toBe(25);
  });

  it('steps the buttons through the levels round the middle', () => {
    const v = fitView(null, area);
    const inOnce = stepZoom(v, area, 1);
    expect(zoomPercent(inOnce, area)).toBe(150);
    expect(zoomPercent(stepZoom(inOnce, area, -1), area)).toBe(100);
    expect(zoomPercent(stepZoom(v, area, -1), area)).toBe(75);
    // From an odd level the next step is the next round one.
    const odd = zoomAround(v, area, v.zoom * 1.3, { x: 0, y: 0 });
    expect(zoomPercent(stepZoom(odd, area, 1), area)).toBe(150);
    expect(zoomPercent(stepZoom(odd, area, -1), area)).toBe(100);
    // The middle of the area stays where it was.
    const mid = { x: area.w / 2 / v.zoom + v.x, y: area.h / 2 / v.zoom + v.y };
    const m = toScreen(inOnce, mid);
    expect(m.x).toBeCloseTo(area.w / 2);
    expect(m.y).toBeCloseTo(area.h / 2);
  });

  it('pans by pixels and never loses the drawing', () => {
    const v = fitView(null, area);
    const moved = panBy(v, area, 100, -40);
    expect(toScreen(moved, { x: 0, y: 0 }).x).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).x + 100);
    expect(toScreen(moved, { x: 0, y: 0 }).y).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).y - 40);
    const far = panBy(v, area, 100_000, 100_000);
    // At least 64 px of the drawing still show at the far edge.
    expect(toScreen(far, { x: 0, y: 0 }).x).toBeLessThanOrEqual(area.w - 64 + 0.001);
    expect(toScreen(far, { x: 0, y: 0 }).y).toBeLessThanOrEqual(area.h - 64 + 0.001);
    const back = boundView({ ...v, x: -100_000, y: -100_000 }, area);
    expect(toScreen(back, { x: PLAN_VIEW_W, y: PLAN_VIEW_H }).x).toBeGreaterThanOrEqual(63.999);
  });

  it('pinches: the point under the fingers follows their middle, zoomed by their spread', () => {
    const v = fitView(null, area);
    const from = [
      { x: 300, y: 400 },
      { x: 400, y: 400 },
    ] as const;
    const to = [
      { x: 250, y: 450 },
      { x: 450, y: 450 },
    ] as const;
    const under = { x: 350 / v.zoom + v.x, y: 400 / v.zoom + v.y };
    const next = pinchView(v, area, from, to);
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
});
