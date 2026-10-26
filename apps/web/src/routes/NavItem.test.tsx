// @vitest-environment happy-dom
// Lives in apps/web (not packages/ui) because the DOM test needs happy-dom and
// react-dom, which the ui package does not depend on.
import { NavItem } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

it('renders sidebar actions as native buttons and navigation as links', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onClick = vi.fn();
  try {
    await act(async () =>
      root.render(
        <>
          <NavItem label="Inbox" onClick={onClick} />
          <NavItem label="Home" href="/" />
        </>,
      ),
    );
    const button = host.querySelector('button');
    button?.focus();
    expect(document.activeElement).toBe(button);
    expect(button?.type).toBe('button');
    await act(async () => button?.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
