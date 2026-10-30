// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { ClipBoard, ClipBoardQuery, ClipBoards } from './boards.ts';

describe('clip board history contract', () => {
  it('defaults to 20 and bounds the coerced limit', () => {
    expect(ClipBoardQuery.parse({})).toEqual({ limit: 20 });
    expect(ClipBoardQuery.parse({ limit: '1' }).limit).toBe(1);
    for (const limit of [0, 21, 1.5, 'no'])
      expect(ClipBoardQuery.safeParse({ limit }).success).toBe(false);
  });
  it('requires a role, board reference and timestamp, and caps the response', () => {
    const item = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      title: 'Board',
      projectName: 'Project',
      myRole: 'editor',
      usedAt: '2026-10-30T12:00:00.000Z',
    };
    expect(ClipBoard.safeParse(item).success).toBe(true);
    expect(ClipBoard.safeParse({ ...item, usedAt: 'yesterday' }).success).toBe(false);
    expect(ClipBoard.safeParse({ ...item, myRole: 'stranger' }).success).toBe(false);
    expect(ClipBoards.safeParse({ items: Array(21).fill(item) }).success).toBe(false);
  });
});
