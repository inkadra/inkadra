// SPDX-License-Identifier: AGPL-3.0-only
import { type ColorToken, dark, light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import { PEER_COLORS, type Peer, samePeople } from './presence.ts';
import { contrast } from './theme.ts';

const token = (color: string) => color.match(/^var\(--ink-([a-z-]+)\)$/)?.[1] as ColorToken;

describe('peer colours', () => {
  it('are tokens, each a different one', () => {
    for (const color of PEER_COLORS) expect(dark[token(color)], color).toBeDefined();
    expect(new Set(PEER_COLORS.map((c) => dark[token(c)])).size).toBe(PEER_COLORS.length);
  });

  // The name tag next to someone's pointer (.peer-cursor__name): on-peer on their colour.
  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('keep names on them at 4.5:1 in the %s theme', (_, theme) => {
    for (const color of PEER_COLORS)
      expect(contrast(theme['on-peer'], theme[token(color)]), color).toBeGreaterThanOrEqual(4.5);
  });
});

describe('samePeople', () => {
  const peer = (name: string, image: string | null = null) =>
    ({ user: { id: 'u2', name, image } }) as unknown as Peer;

  it('tells a new name or picture apart, so the typing line shows it', () => {
    expect(samePeople([peer('Paola')], [peer('Paola')])).toBe(true);
    expect(samePeople([peer('Paola')], [peer('Paola Rossi')])).toBe(false);
    expect(samePeople([peer('Paola')], [peer('Paola', 'https://example.com/p.png')])).toBe(false);
    expect(samePeople([peer('Paola')], [])).toBe(false);
  });
});
