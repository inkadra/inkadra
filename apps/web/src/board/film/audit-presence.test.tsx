// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PresencePanel } from './CallSheetPhone.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: unknown) => `${key}${vars ? JSON.stringify(vars) : ''}`,
  }),
}));
it('shows both accounts sharing a cast name and counts accounts only once', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PresencePanel
          day={{
            id: 'd',
            date: '2026-11-10',
            callTime: '08:00',
            wrap: null,
            location: '',
            notes: '',
            blocks: [
              {
                id: 'b',
                type: 'shot',
                title: '',
                start: null,
                duration: 30,
                shotId: null,
                cast: ['Bruno'],
                departments: [],
              },
            ],
          }}
          data={{
            canManage: true,
            links: [
              { castKey: 'bruno', userId: 'one' },
              { castKey: 'bruno', userId: 'two' },
            ],
            responses: [
              { dayId: 'd', userId: 'one', status: 'confirmed' },
              { dayId: 'd', userId: 'two', status: 'declined' },
            ],
          }}
          people={[]}
          canLink={false}
          onLink={async () => {}}
        />,
      ),
    );
    expect(host.querySelectorAll('.call-sheet__row')).toHaveLength(2);
    expect(host.textContent).toContain('"total":2');
    expect(host.textContent).toContain('callSheet.status.declined');
  } finally {
    act(() => root.unmount());
  }
});
