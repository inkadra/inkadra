// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  RESTORE_CARDS_MAX,
  RESTORE_CARDS_MAX_LENGTH,
  readBoardNotice,
  readRestoreCardsRequest,
  readRestoreCardsResult,
} from './index.ts';

const requestId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const card = { id: 'V1StGXR8_Z5jdHi6B-myT', type: 'note' };
const request = {
  type: 'restoreCards',
  requestId,
  clipboard: { version: 1, elements: [card], bodies: {} },
  at: { x: 1, y: 2 },
};

describe('restore requests', () => {
  it('reads a request', () => {
    expect(readRestoreCardsRequest(JSON.stringify(request))).toEqual({ request });
  });

  it('leaves other stateless messages alone', () => {
    expect(readRestoreCardsRequest('{"type":"access","readOnly":true}')).toBeNull();
    expect(readRestoreCardsRequest('not json "restoreCards"')).toBeNull();
    expect(readRestoreCardsRequest('"restoreCards"')).toBeNull();
  });

  it('refuses a malformed request, with its id when it can be read', () => {
    expect(readRestoreCardsRequest(JSON.stringify({ ...request, at: null }))).toEqual({
      refused: 'invalid',
      requestId,
    });
    expect(readRestoreCardsRequest(JSON.stringify({ ...request, requestId: 'x' }))).toEqual({
      refused: 'invalid',
      requestId: null,
    });
    const v2 = { ...request, clipboard: { ...request.clipboard, version: 2 } };
    expect(readRestoreCardsRequest(JSON.stringify(v2))).toMatchObject({ refused: 'invalid' });
  });

  it('refuses more cards or text than one request takes', () => {
    const many = Array.from({ length: RESTORE_CARDS_MAX + 1 }, (_, i) => ({ id: `card-${i}xx` }));
    const tooMany = { ...request, clipboard: { ...request.clipboard, elements: many } };
    expect(readRestoreCardsRequest(JSON.stringify(tooMany))).toEqual({
      refused: 'tooLarge',
      requestId,
    });
    // A card in both lists counts once.
    const both = Array.from({ length: RESTORE_CARDS_MAX }, (_, i) => `card-${i}xx`);
    const twice = {
      ...request,
      clipboard: {
        ...request.clipboard,
        elements: both.map((id) => ({ id })),
        cards: Object.fromEntries(both.map((id) => [id, ''])),
      },
    };
    expect(readRestoreCardsRequest(JSON.stringify(twice))).toHaveProperty('request');
    const long = { ...request, pad: 'x'.repeat(RESTORE_CARDS_MAX_LENGTH) };
    expect(readRestoreCardsRequest(JSON.stringify(long))).toEqual({
      refused: 'tooLarge',
      requestId,
    });
  });
});

describe('restore answers', () => {
  it('reads each outcome', () => {
    const restored = {
      type: 'restoreCardsResult',
      requestId,
      outcome: 'restored',
      ids: [card.id],
      outside: [],
      own: [card.id],
      repeat: true,
    };
    expect(readRestoreCardsResult(JSON.stringify(restored))).toEqual(restored);
    const present = { type: 'restoreCardsResult', requestId, outcome: 'present', present: [] };
    expect(readRestoreCardsResult(JSON.stringify(present))).toEqual(present);
    const refused = { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'moved' };
    expect(readRestoreCardsResult(JSON.stringify(refused))).toEqual(refused);
  });

  it('reads nothing else, and is not a board notice', () => {
    const odd = { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'odd' };
    expect(readRestoreCardsResult(JSON.stringify(odd))).toBeNull();
    expect(readRestoreCardsResult('{')).toBeNull();
    const present = { type: 'restoreCardsResult', requestId, outcome: 'present', present: [] };
    expect(readBoardNotice(JSON.stringify(present))).toBeNull();
  });
});
