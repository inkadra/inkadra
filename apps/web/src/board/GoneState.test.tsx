// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { GoneState } from './DeniedState.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('takes the focus from the board it replaces and is named by its title (#951)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <GoneState reason="trash" kept={null} />
        </MemoryRouter>,
      ),
    );
    const state = host.querySelector('.board-state');
    expect(document.activeElement).toBe(state);
    expect(state?.getAttribute('aria-label')).toBe('board.gone.trashTitle');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('leaves the focus where the person put it, outside the board (#951)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const search = document.createElement('input');
  document.body.append(search);
  search.focus();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <GoneState reason="deleted" kept={null} />
        </MemoryRouter>,
      ),
    );
    expect(document.activeElement).toBe(search);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    search.remove();
  }
});
