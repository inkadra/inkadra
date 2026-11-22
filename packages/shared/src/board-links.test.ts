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

  it('needs no URL constructor: a relative path is read without one', () => {
    const original = globalThis.URL;
    // React Native's URL cannot resolve a relative path against a base.
    globalThis.URL = class {
      constructor() {
        throw new Error('no URL');
      }
    } as unknown as typeof URL;
    try {
      expect(parseBoardHref(boardHref(P, B, FRAME))?.cardId).toBe(FRAME);
      expect(
        parseBoardHref(
          `https://ink.example.com${boardHref(P, B, FRAME)}`,
          'https://ink.example.com',
        )?.cardId,
      ).toBe(FRAME);
    } finally {
      globalThis.URL = original;
    }
  });

  it('refuses a path some URL parser would read as another host', () => {
    const rest = `/p/${P}/b/${B}?el=${FRAME}`;
    for (const href of [
      `/\\evil.example${rest}`,
      `\\\\evil.example${rest}`,
      `/\\/evil.example${rest}`,
      `/\t/evil.example${rest}`,
      `/\n/evil.example${rest}`,
      `\u0000/p/${P}/b/${B}`,
      ` /p/${P}/b/${B}`,
      `/p/${P}/b/${B}?el=${FRAME}\u007f`,
      `//evil.example${rest}`,
      `/./p/${P}/b/${B}`,
      `/p/${P}/b/../b/${B}`,
    ])
      expect(parseBoardHref(href, 'https://ink.example.com'), JSON.stringify(href)).toBeNull();
  });

  it('refuses escapes in the ids and more than one card', () => {
    expect(parseBoardHref(`/p/${P}%2Fx/b/${B}`)).toBeNull();
    expect(parseBoardHref(`/p/${encodeURIComponent(P)}/b/${B}`)?.projectId).toBe(P);
    expect(parseBoardHref(`/p/${P}/b/${B}?el=V1StGXR8%2F_Z5jdHi6B`)).toBeNull();
    expect(parseBoardHref(`/p/${P}/b/${B}?el=${FRAME}&el=${FRAME}`)).toBeNull();
    expect(parseBoardHref(`/p/${P}/b/${B}?el=`)).toBeNull();
  });

  it('refuses a key that decodes to el, alone or before or after a literal one', () => {
    const OTHER = 'W2StGXR8_Z5jdHi6B-myT';
    const base = `/p/${P}/b/${B}?`;
    for (const q of [
      `%65l=${FRAME}`,
      `%65%6C=${FRAME}`,
      `e%6c=${FRAME}`,
      `%65l=${OTHER}&el=${FRAME}`,
      `el=${FRAME}&%65l=${OTHER}`,
    ])
      expect(parseBoardHref(base + q), q).toBeNull();
    // Other parameters, even with escapes, are left alone.
    expect(parseBoardHref(`${base}thread=%41&el=${FRAME}&x%2By=1`)?.cardId).toBe(FRAME);
    expect(parseBoardHref(`${base}%E0%A4%A=1&el=${FRAME}`)?.cardId).toBe(FRAME);
  });

  it('reads a bracketed host only when it is an IPv6 address, even with a matching origin', () => {
    const rest = `/p/${P}/b/${B}?el=${FRAME}`;
    for (const host of [
      '[::1]',
      '[::]',
      '[1:2:3:4:5:6:7:8]',
      '[fd00::1]',
      '[::ffff:192.0.2.1]',
      '[1::2:3:4:5:6:7]',
    ])
      expect(parseBoardHref(`https://${host}${rest}`, `https://${host}`)?.cardId, host).toBe(FRAME);
    for (const host of [
      '[fd00:::1]',
      '[::1::]',
      '[1::2::3]',
      '[1:2:3:4:5:6:7:8:9]',
      '[1:2:3:4:5:6:7]',
      '[1::2:3:4:5:6:7:8]',
      '[12345::1]',
      '[fd00::1.2.3]',
      '[::ffff:256.0.0.1]',
      '[::ffff:01.0.0.1]',
      '[1.2.3.4::]',
      '[::1.2.3.4:5]',
      '[:1::]',
      '[1:]',
      '[:]',
      '[.]',
    ])
      expect(parseBoardHref(`https://${host}${rest}`, `https://${host}`), host).toBeNull();
  });

  it('reads an absolute URL on a bracketed IPv6 origin, host and port exact', () => {
    const rest = `/p/${P}/b/${B}?el=${FRAME}`;
    expect(parseBoardHref(`http://[fd00::1]:8080${rest}`, 'http://[fd00::1]:8080')?.cardId).toBe(
      FRAME,
    );
    expect(parseBoardHref(`https://[FD00::1]${rest}`, 'https://[fd00::1]/')?.cardId).toBe(FRAME);
    for (const [href, origin] of [
      [`http://[fd00::2]:8080${rest}`, 'http://[fd00::1]:8080'],
      [`http://[fd00::1]:8081${rest}`, 'http://[fd00::1]:8080'],
      [`http://[fd00::1]${rest}`, 'http://[fd00::1]:8080'],
      [`http://[fd00::1]:8080@evil.example${rest}`, 'http://[fd00::1]:8080'],
      [`http://fd00::1${rest}`, 'http://fd00::1'],
      [`http://[fd00::1%25eth0]${rest}`, 'http://[fd00::1%25eth0]'],
    ])
      expect(parseBoardHref(href as string, origin), href).toBeNull();
  });

  it('reads an absolute URL only on an http(s) origin, matched exactly', () => {
    const rest = `/p/${P}/b/${B}?el=${FRAME}`;
    expect(
      parseBoardHref(`HTTPS://Ink.Example.com${rest}`, 'https://ink.example.com')?.cardId,
    ).toBe(FRAME);
    expect(
      parseBoardHref(`http://ink.example.com:8080${rest}`, 'http://ink.example.com:8080')?.cardId,
    ).toBe(FRAME);
    for (const [href, origin] of [
      [`https://ink.example.com.evil.example${rest}`, 'https://ink.example.com'],
      [`https://ink.example.com@evil.example${rest}`, 'https://ink.example.com'],
      [`https://ink.example.com:8443${rest}`, 'https://ink.example.com'],
      [`http://ink.example.com${rest}`, 'https://ink.example.com'],
      [`null${rest}`, 'null'],
      [`file://${rest}`, 'file://'],
      [`javascript:${rest}`, 'javascript:'],
      [`https://ink.example.com${rest}`, 'https://ink.example.com/app'],
      [`https://user@ink.example.com${rest}`, 'https://user@ink.example.com'],
      [`https://ink.example.com${rest}`, ''],
    ])
      expect(parseBoardHref(href as string, origin), href).toBeNull();
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
      'mailto:someone@example.com',
      'javascript:alert(1)',
    ])
      expect(parseBoardHref(href, 'https://ink.example.com'), href).toBeNull();
  });
});
