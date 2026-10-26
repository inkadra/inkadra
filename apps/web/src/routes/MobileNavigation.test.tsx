// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MobileNavigation } from './MobileNavigation.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('exposes the existing shell actions and announces active and expanded states', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const actions = {
    onHome: vi.fn(),
    onProjects: vi.fn(),
    onNew: vi.fn(),
    onInbox: vi.fn(),
    onProfile: vi.fn(),
  };
  try {
    await act(async () =>
      root.render(
        <MobileNavigation
          {...actions}
          pathname="/"
          inboxOpen={false}
          drawerOpen={false}
          unread={3}
        />,
      ),
    );
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(5);
    expect(buttons[0]?.getAttribute('aria-current')).toBe('page');
    expect(buttons[1]?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(buttons[2]?.getAttribute('aria-label')).toBe('nav.newProject');
    expect(buttons[3]?.textContent).toContain('3');
    for (const button of buttons) button.click();
    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        <MobileNavigation {...actions} pathname="/settings" inboxOpen drawerOpen unread={0} />,
      ),
    );
    expect(buttons[0]?.hasAttribute('aria-current')).toBe(false);
    expect(buttons[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(buttons[3]?.getAttribute('aria-expanded')).toBe('true');
    // An open inbox or drawer takes over: no page is announced as current under it.
    expect(buttons[4]?.hasAttribute('aria-current')).toBe(false);
    expect(buttons[3]?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(host.querySelector('.mobile-bottom-nav__badge')).toBeNull();
    await act(async () =>
      root.render(
        <MobileNavigation
          {...actions}
          pathname="/settings"
          inboxOpen={false}
          drawerOpen={false}
          unread={0}
        />,
      ),
    );
    expect(buttons[4]?.getAttribute('aria-current')).toBe('page');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
