// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactionSummary } from '@inkadra/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReactionBar } from './ReactionBar.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o ? `${key}:${Object.values(o).join('/')}` : key,
  }),
}));

const thumbs: ReactionSummary = { emoji: '👍', count: 2, mine: true, names: ['Maya', 'Leo'] };
const heart: ReactionSummary = { emoji: '❤️', count: 1, mine: false, names: ['Giulia'] };

describe('ReactionBar', () => {
  it('shows chips with counts, mine marked, and who reacted in the title', () => {
    const html = renderToStaticMarkup(<ReactionBar reactions={[thumbs, heart]} />);
    expect(html).toContain('reaction-chip is-mine');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="Maya, Leo"');
    expect(html).toContain('👍</span> 2');
    // Read-only: chips cannot be pressed and there is no way to add.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain('reaction-add');
  });

  it('offers the add button only to people who can react', () => {
    expect(renderToStaticMarkup(<ReactionBar reactions={[]} />)).toBe('');
    const html = renderToStaticMarkup(<ReactionBar reactions={[]} onToggle={async () => {}} />);
    expect(html).toContain('reaction-add');
  });
});
