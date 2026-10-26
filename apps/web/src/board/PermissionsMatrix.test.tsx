// @vitest-environment happy-dom
import { NavItem } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PermissionsMatrix } from './PermissionsMatrix.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('highlights the selected role and updates guest rights as link options change', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PermissionsMatrix selectedRole="owner" />));
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('.is-active th')?.textContent).toBe('roles.owner');
    await act(async () => root.render(<PermissionsMatrix selectedRole="viewer" />));
    expect(host.querySelectorAll('.is-active')).toHaveLength(1);
    expect(host.querySelector('.is-active th')?.textContent).toBe('roles.viewer');
    await act(async () =>
      root.render(
        <PermissionsMatrix guest={{ role: 'guest_view', allowDownload: false, proofing: false }} />,
      ),
    );
    expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      'share.matrix.yes',
      'share.matrix.no',
      'share.matrix.no',
      'share.matrix.no',
      'share.matrix.no',
    ]);
    await act(async () =>
      root.render(
        <PermissionsMatrix
          guest={{ role: 'guest_comment', allowDownload: true, proofing: false }}
        />,
      ),
    );
    expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      'share.matrix.yes',
      'share.matrix.yes',
      'share.matrix.no',
      'share.matrix.no',
      'share.matrix.yes',
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

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
