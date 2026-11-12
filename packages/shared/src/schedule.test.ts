// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { blockTarget, DayCall, daysForBoard, ShootingDayInput, targetKey } from './schedule.ts';

const block = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'shot',
  title: 'Arrival',
  start: null,
  duration: 30,
  shotId: null,
  cast: ['Mara'],
  departments: [],
} as const;
const day = {
  date: '2026-11-19',
  callTime: '07:30',
  wrap: null,
  location: '',
  notes: '',
  blocks: [block],
};
const call = (n: number) => ({
  crewMemberId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  call: null,
  pickup: null,
});

describe('day calls and block notes (decision 0092)', () => {
  it('reads a day saved before calls and notes as it was', () => {
    const parsed = ShootingDayInput.parse(day);
    expect(parsed).toEqual(day);
    expect(parsed.calls).toBeUndefined();
    expect(parsed.blocks[0]?.notes).toBeUndefined();
  });
  it('keeps calls and notes, with optional absence', () => {
    const calls = [
      { ...call(2), call: '07:00', pickup: 'Hotel 06:45' },
      { ...call(3), absent: true },
      { ...call(4), absent: false },
    ];
    const parsed = ShootingDayInput.parse({
      ...day,
      blocks: [{ ...block, notes: 'LIGHTS ON' }],
      calls,
    });
    expect(parsed.calls).toEqual(calls);
    expect(parsed.blocks[0]?.notes).toBe('LIGHTS ON');
  });
  it('bounds and validates them', () => {
    expect(DayCall.safeParse({ ...call(2), call: '7:00' }).success).toBe(false);
    expect(DayCall.safeParse({ ...call(2), pickup: 'x'.repeat(1001) }).success).toBe(false);
    expect(DayCall.safeParse({ ...call(2), phone: '1' }).success).toBe(false);
    expect(ShootingDayInput.safeParse({ ...day, calls: [call(2), call(2)] }).success).toBe(false);
    expect(
      ShootingDayInput.safeParse({ ...day, calls: Array.from({ length: 501 }, (_, i) => call(i)) })
        .success,
    ).toBe(false);
    expect(
      ShootingDayInput.safeParse({ ...day, blocks: [{ ...block, notes: 'x'.repeat(2001) }] })
        .success,
    ).toBe(false);
  });
});

describe('blocks across storyboards (decision 0123)', () => {
  const shot = (shotId: string | null, shotBoardId?: string) => ({
    type: 'shot' as const,
    shotId,
    ...(shotBoardId ? { shotBoardId } : {}),
  });
  const scene = (sceneId: string, sceneBoardId?: string) => ({
    type: 'scene' as const,
    shotId: null,
    sceneId,
    ...(sceneBoardId ? { sceneBoardId } : {}),
  });

  it("reads a block without a board as one of the day's own board", () => {
    expect(blockTarget(shot('f1'), 'prod')).toEqual({ kind: 'shot', boardId: 'prod', id: 'f1' });
    expect(blockTarget(shot('f1', 'sbA'), 'prod')).toEqual({
      kind: 'shot',
      boardId: 'sbA',
      id: 'f1',
    });
    expect(blockTarget(scene('s1', 'sbB'), 'prod')).toEqual({
      kind: 'scene',
      boardId: 'sbB',
      id: 's1',
    });
    expect(blockTarget({ type: 'break', shotId: null }, 'prod')).toBeNull();
    // The same element id on two storyboards is two keys.
    expect(targetKey('sbA', 'f1')).not.toBe(targetKey('sbB', 'f1'));
  });

  it("keeps every day and every block's place, and only this storyboard's frames and scenes", () => {
    const days = [
      {
        id: 'd1',
        boardId: 'prod',
        blocks: [shot('f1', 'sbA'), { type: 'setup' as const, shotId: null }, shot('f1', 'sbB')],
      },
      { id: 'd2', boardId: 'prod', blocks: [scene('s1', 'sbB'), scene('s2', 'sbA')] },
      { id: 'd3', boardId: 'sbA', blocks: [shot('f9')] },
    ];
    const [d1, d2, d3] = daysForBoard(days, 'sbA');
    expect(d1?.blocks.map((b) => b.shotId)).toEqual(['f1', null, null]);
    expect(d1?.blocks.map((b) => b.type)).toEqual(['shot', 'setup', 'shot']);
    expect(d2?.blocks.map((b) => ('sceneId' in b ? b.sceneId : undefined))).toEqual([
      undefined,
      's2',
    ]);
    // A day of the storyboard itself, from before the Production board, stays as it is.
    expect(d3).toBe(days[2]);
    expect(daysForBoard(days, 'sbC').flatMap((d) => d.blocks.map((b) => b.shotId))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
