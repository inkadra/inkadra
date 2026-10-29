// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ContentKind, kindColor } from './kind-color.ts';
import { contrast, distance } from './oklab.ts';
import { type ColorToken, dark, light } from './tokens.ts';
import { tokensCss } from './tokens-css.ts';

describe('tokens', () => {
  it('tokens.css matches tokens.ts', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    expect(css, 'run `pnpm --filter @inkadra/ui tokens`').toBe(tokensCss());
  });

  it('light theme defines every dark token', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('white on the button blue keeps 4.5:1 contrast', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    for (const theme of [light, dark]) {
      for (const name of [
        'tag-orange',
        'tag-purple',
        'tag-green',
        'tag-teal',
        'tag-yellow',
        'tag-red',
        'tag-pink',
      ] as const) {
        expect(ratio(theme[name], theme['surface-1'])).toBeGreaterThanOrEqual(3);
        expect(ratio(theme[name], theme[`${name}-bg`])).toBeGreaterThanOrEqual(3);
      }
    }
    expect(ratio(dark['on-accent'], dark['accent-button'])).toBeGreaterThan(4.5);
    expect(ratio(dark['text-muted'], dark['bg-app'])).toBeGreaterThan(4.5);
    expect(ratio(light['text-secondary'], light['bg-panel'])).toBeGreaterThan(4.5);
  });

  /** The colour a content kind is drawn with, as a token. */
  const kindToken = (kind: ContentKind): ColorToken => {
    const color = kindColor[kind];
    return color ? `tag-${color}` : 'text-secondary';
  };
  const kindTokens = [...new Set((Object.keys(kindColor) as ContentKind[]).map(kindToken))];
  /** Kinds shown side by side: project sidebar modules, then the board toolbar. */
  const neighbours: ContentKind[][] = [
    ['storyboard', 'shotlist', 'schedule', 'review'],
    // biome-ignore format: one toolbar, left to right
    ['select', 'hand', 'arrow', 'note', 'image', 'link', 'todo', 'color', 'column', 'board', 'frame', 'storyboard'],
  ];

  it('keeps every pair of content-kind colours apart, more so for neighbours', () => {
    expect(kindTokens).toHaveLength(7);
    for (const [name, theme] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      kindTokens.forEach((a, i) => {
        for (const b of kindTokens.slice(i + 1))
          expect(distance(theme[a], theme[b]), `${name} ${a} / ${b}`).toBeGreaterThanOrEqual(0.1);
      });
      for (const row of neighbours)
        row.slice(1).forEach((kind, i) => {
          const [a, b] = [kindToken(row[i] as ContentKind), kindToken(kind)];
          if (a !== b)
            expect(distance(theme[a], theme[b]), `${name} ${a} / ${b}`).toBeGreaterThanOrEqual(
              0.12,
            );
        });
      // Teal sits nearest the accent: blue stays reserved for selection and focus.
      expect(distance(theme['tag-teal'], theme['accent-primary'])).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('keeps the project identity palette distinguishable', () => {
    const palette: ColorToken[] = [
      'tag-blue',
      'tag-orange',
      'tag-purple',
      'tag-green',
      'text-muted',
      'tag-teal',
      'tag-yellow',
      'tag-red',
      'tag-pink',
    ];
    for (const [name, theme] of [
      ['light', light],
      ['dark', dark],
    ] as const)
      palette.forEach((a, i) => {
        for (const b of palette.slice(i + 1))
          expect(distance(theme[a], theme[b]), `${name} ${a} / ${b}`).toBeGreaterThanOrEqual(0.085);
      });
  });

  /** `color-mix(in srgb, fg p%, bg)`, as the film status chips draw their tint. */
  const mix = (fg: string, bg: string, p: number) =>
    `#${[1, 3, 5]
      .map((i) => {
        const channel = (c: string) => Number.parseInt(c.slice(i, i + 2), 16);
        return Math.round(channel(fg) * p + channel(bg) * (1 - p))
          .toString(16)
          .padStart(2, '0');
      })
      .join('')}`;

  it('keeps film status chips and pills at 4.5:1 (film.css)', () => {
    for (const [name, theme] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      // .film-status--draft / --shot / --retake: the hue on a 12% tint of itself over surface-1.
      for (const tag of ['tag-purple', 'tag-green', 'tag-orange'] as const)
        expect(
          contrast(theme[tag], mix(theme[tag], theme['surface-1'], 0.12)),
          `${name} ${tag} chip`,
        ).toBeGreaterThanOrEqual(4.5);
      // .film-status--approved and .shots__group-pill--approved.
      expect(
        contrast(theme['tag-purple-bg'], theme['tag-purple']),
        `${name} approved`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
