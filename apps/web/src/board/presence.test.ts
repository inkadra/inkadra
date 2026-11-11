// SPDX-License-Identifier: AGPL-3.0-only
import { type ColorToken, dark, light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import { PEER_COLORS } from './presence.ts';
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
