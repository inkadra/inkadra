import type { ClipboardData } from '@inkadra/canvas-core';
import { expect, it } from 'vitest';
import { decodeClipboard, encodeClipboard, skippedNotice } from './clipboard.ts';

/** A DataTransfer stand-in: the clipboard of a copy, read by the paste. */
function transfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  } as unknown as DataTransfer;
}

it('carries the fields of decision 0101 through the system clipboard, under the same version', () => {
  const data: ClipboardData = {
    version: 1,
    elements: [],
    bodies: {},
    source: { boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', schemaVersion: 22 },
    cards: { cardAAAAAAAAA: 'AAA=' },
  };
  const clip = transfer();
  encodeClipboard(clip, data);
  // A build of before checks only these two, so it still pastes `elements`.
  const read = decodeClipboard(clip);
  expect(read?.version === 1 && Array.isArray(read.elements)).toBe(true);
  expect(read).toEqual(data);
});

it('offers Undo for cards left out only when something was pasted', () => {
  expect(skippedNotice({ ids: [], skipped: 2 })).toEqual({ count: 2, undo: false });
  expect(skippedNotice({ ids: ['cardAAAAAAAAA'], skipped: 1 })).toEqual({ count: 1, undo: true });
  expect(skippedNotice({ ids: ['cardAAAAAAAAA'], skipped: 0 })).toBeNull();
});
