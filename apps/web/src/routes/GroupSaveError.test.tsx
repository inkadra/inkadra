// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { GroupSaveError } from './ProjectGroups.tsx';
import { GROUP_ERROR_MS, moveToGroup, reportGroupError } from './project-groups.ts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('says when a project dropped on a group was not saved, then lets it go (#776)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(api, 'put').mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GroupSaveError />));
    expect(host.textContent).toBe('');
    await act(async () => moveToGroup('p1', 'g1').catch(reportGroupError));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('projectsPage.saveError');
    await act(async () => vi.advanceTimersByTime(GROUP_ERROR_MS));
    expect(host.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
