// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { boardHref, parseBoardHref } from './board-links.ts';
import { notificationPath } from './notifications.ts';

const P = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const B = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const FRAME = 'V1StGXR8_Z5jdHi6B-myT';

describe('boardHref', () => {
  it('is the address a notification about the card leads to', () => {
    expect(boardHref(P, B, FRAME)).toBe(`/p/${P}/b/${B}?el=${FRAME}`);
    expect(boardHref(P, B, FRAME)).toBe(
      notificationPath({ projectId: P, boardId: B, elementId: FRAME, commentId: null }),
    );
  });

  it('leads to the board itself without a card', () => {
    expect(boardHref(P, B)).toBe(`/p/${P}/b/${B}`);
    expect(boardHref(P, B, null)).toBe(`/p/${P}/b/${B}`);
  });
});

describe('parseBoardHref', () => {
  it('reads what boardHref writes', () => {
    expect(parseBoardHref(boardHref(P, B, FRAME))).toEqual({
      projectId: P,
      boardId: B,
      cardId: FRAME,
    });
    expect(parseBoardHref(boardHref(P, B))).toEqual({ projectId: P, boardId: B, cardId: null });
  });

  it('ignores the other parameters of a notification', () => {
    expect(parseBoardHref(`/p/${P}/b/${B}?el=${FRAME}&thread=t&comment=c`)?.cardId).toBe(FRAME);
  });

  it('reads an absolute URL only on the given origin', () => {
    const href = `https://ink.example.com/p/${P}/b/${B}?el=${FRAME}`;
    expect(parseBoardHref(href)).toBeNull();
    expect(parseBoardHref(href, 'https://ink.example.com')?.cardId).toBe(FRAME);
    expect(parseBoardHref(href, 'https://ink.example.com/')?.cardId).toBe(FRAME);
    expect(parseBoardHref(href, 'https://other.example.com')).toBeNull();
    expect(parseBoardHref(`//ink.example.com/p/${P}/b/${B}`, 'https://ink.example.com')).toBeNull();
  });

  it('refuses other addresses and ids that are not ids', () => {
    for (const href of [
      '',
      'not a url',
      'https://example.com',
      `/p/${P}`,
      `/p/${P}/b/${B}/x`,
      `/p/${P}/board/${B}`,
      `/p/x/b/${B}`,
      `/p/${P}/b/${B}?el=short`,
      `/p/${P}/b/${B}?el=${'a'.repeat(65)}`,
      `/p/${P}/b/%E0%A4%A`,
      'javascript:alert(1)',
    ])
      expect(parseBoardHref(href, 'https://ink.example.com'), href).toBeNull();
  });
});
