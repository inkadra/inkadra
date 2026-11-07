import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { splitSheetItems } from './CardSheet.tsx';
import { ContextMenu, joinMenuSections, type MenuItem } from './chrome.tsx';

describe('board header menu', () => {
  it('shows entry points that are not ready yet without letting them act', () => {
    const action = vi.fn();
    const html = renderToStaticMarkup(
      <ContextMenu
        onClose={vi.fn()}
        items={[
          { label: 'Board versions', action },
          { divider: true },
          { label: 'Export', disabled: true, hint: 'Coming soon' },
        ]}
      />,
    );
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('title=');
    expect(html).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('menu__hint');
    expect(html).toContain('Export');
  });

  it('leaves ordinary items without a disabled state', () => {
    const html = renderToStaticMarkup(
      <ContextMenu onClose={vi.fn()} items={[{ label: 'Board versions', action: vi.fn() }]} />,
    );
    expect(html).toContain('Board versions');
    expect(html).not.toContain('aria-disabled');
  });
});

describe('menu sections', () => {
  const act = (label: string) => ({ label, action: vi.fn() });
  const names = (items: MenuItem[]) =>
    items.map((item) => ('label' in item ? item.label : item.divider ? '—' : `# ${item.heading}`));

  it('titles each section and joins them with one divider', () => {
    const items = joinMenuSections([
      { items: [act('Open')] },
      { heading: 'Image', items: [act('Crop')] },
      { heading: 'Organize', items: [act('Duplicate')] },
      { items: [act('Delete')] },
    ]);
    expect(names(items)).toEqual([
      'Open',
      '—',
      '# Image',
      'Crop',
      '—',
      '# Organize',
      'Duplicate',
      '—',
      'Delete',
    ]);
  });

  it('drops empty sections without leaving a heading or a doubled divider', () => {
    const items = joinMenuSections([
      { items: [] },
      { heading: 'Image', items: [{ divider: true }] },
      {
        heading: 'Organize',
        items: [{ divider: true }, act('Tags'), { divider: true }, { divider: true }, act('Lock')],
      },
      { heading: 'Share', items: [act('Export'), { divider: true }] },
    ]);
    expect(names(items)).toEqual(['# Organize', 'Tags', '—', 'Lock', '—', '# Share', 'Export']);
  });
});

describe('phone card sheet', () => {
  it('drops a section heading whose actions all moved to the sheet slots', () => {
    const { rest } = splitSheetItems([
      { label: 'Tags', action: vi.fn() },
      { divider: true },
      { heading: 'Share' },
      { label: 'Hide from guests', sheet: 'guest', action: vi.fn() },
      { divider: true },
      { label: 'Delete', sheet: 'delete', action: vi.fn() },
    ]);
    expect(rest).toEqual([{ label: 'Tags', action: expect.any(Function) }]);
  });
});
