// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../lib/api.ts';
import { CalendarSettings } from './CalendarSettings.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => vi.restoreAllMocks());
it.each([
  [409, 'calendar.rotated'],
  [500, 'calendar.error'],
])('explains a failed %i answer', async (status, message) => {
  vi.spyOn(api, 'get').mockRejectedValue(new RequestError(status, 'conflict', 'x'));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<CalendarSettings />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
  await act(async () => root.unmount());
  host.remove();
});
