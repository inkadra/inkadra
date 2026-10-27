import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './chrome.tsx';

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
