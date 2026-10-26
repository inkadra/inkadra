import { createElement, intersects, listElements, storyboardOf } from '@inkadra/canvas-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CommandPalette } from './chrome.tsx';
import { BoardStore } from './store.ts';
import { seedStoryboard, templateRect } from './templates.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => (values?.name ? `${key}: ${values.name}` : key),
  }),
}));

describe('templates', () => {
  it('offers every template to editors in the command palette, separately from card commands', () => {
    const render = (readOnly: boolean) =>
      renderToStaticMarkup(
        <CommandPalette
          readOnly={readOnly}
          onClose={vi.fn()}
          onAdd={vi.fn()}
          onTemplate={vi.fn()}
          onZoom={vi.fn()}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onToggleUnsorted={vi.fn()}
        />,
      );
    const editable = render(false);
    const viewer = render(true);
    for (const id of ['moodboard', 'storyboard', 'production']) {
      expect(editable).toContain(`board.palette.template: templates.${id}.name`);
      expect(viewer).not.toContain(`templates.${id}.name`);
    }
  });

  it('seeds a new storyboard with a translated scene and three shots in one undo step', () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    expect(seedStoryboard(doc, 'Opening', 'filmmaker')).toBe(true);
    const groups = storyboardOf(listElements(doc));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.scene).toMatchObject({
      number: '1',
      title: 'Opening',
      createdBy: 'filmmaker',
    });
    expect(groups[0]?.frames).toHaveLength(3);
    expect(groups[0]?.frames.every((frame) => frame.parent === groups[0]?.scene?.id)).toBe(true);
    expect(seedStoryboard(doc, 'Apertura', 'filmmaker')).toBe(false);
    store.undo.undo();
    expect(listElements(doc)).toEqual([]);
    store.destroy();
    doc.destroy();
  });

  it('does not seed over work that arrived during synchronization', () => {
    const doc = new Y.Doc();
    const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
    expect(seedStoryboard(doc, 'Opening', 'filmmaker')).toBe(false);
    expect(listElements(doc).map((el) => el.id)).toEqual([note.id]);
    doc.destroy();
  });

  it('centers templates in free space and reserves all columns and swatches', () => {
    const rect = templateRect('moodboard', { x: 800, y: 200 }, []);
    expect(rect.x + rect.w / 2).toBe(800);
    expect(rect.w).toBe(1160);
    expect(rect.h).toBeGreaterThan(900);
    expect(templateRect('production', { x: 800, y: 200 }, []).w).toBe(860);
  });

  it('finds space beyond dense content instead of giving up after a few offsets', () => {
    const occupied = Array.from({ length: 30 }, (_, i) => ({ x: 0, y: i * 150, w: 1500, h: 140 }));
    for (const id of ['moodboard', 'production', 'storyboard'] as const) {
      const rect = templateRect(id, { x: 750, y: 100 }, occupied);
      expect(occupied.every((other) => !intersects(rect, other))).toBe(true);
      expect(rect.y).toBeGreaterThan(occupied.at(-1)?.y ?? 0);
    }
  });
});
