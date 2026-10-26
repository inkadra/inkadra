// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CardReview } from './CardReview.tsx';

const mockState = {
  preview: false,
  counts: new Map<string, { open: number; total: number }>([
    ['el-1', { open: 3, total: 5 }],
    ['el-2', { open: 0, total: 1 }],
  ]),
  reviews: new Map<string, { status: string; history: unknown[] }>([
    ['el-1', { status: 'approved', history: [] }],
    ['el-2', { status: 'changes_requested', history: [] }],
  ]),
  pins: new Map(),
  pinTarget: null,
};

vi.mock('./review-store.ts', () => ({
  useReviews: (selector: (s: typeof mockState) => unknown) => selector(mockState),
  openComments: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count) return `${key}:${params.count}`;
      if (params?.status) return `${key}:${params.status}`;
      return key;
    },
  }),
}));

describe('CardReview', () => {
  it('renders review status and open comment count inside card-review', () => {
    const html = renderToStaticMarkup(<CardReview elementId="el-1" />);
    expect(html).toContain('class="card-review"');
    expect(html).toContain('review-chip--approved');
    expect(html).toContain('card-review__count');
    expect(html).toContain('3');
  });

  it('adds card-review--shifted when shifted prop is true (e.g. locked card)', () => {
    const normal = renderToStaticMarkup(<CardReview elementId="el-1" shifted={false} />);
    expect(normal).toContain('class="card-review"');
    expect(normal).not.toContain('card-review--shifted');

    const shifted = renderToStaticMarkup(<CardReview elementId="el-1" shifted={true} />);
    expect(shifted).toContain('class="card-review card-review--shifted"');
  });

  it('renders status chip even when open comment count is 0', () => {
    const html = renderToStaticMarkup(<CardReview elementId="el-2" />);
    expect(html).toContain('class="card-review"');
    expect(html).toContain('review-chip--changes_requested');
    expect(html).not.toContain('card-review__count');
  });
});
