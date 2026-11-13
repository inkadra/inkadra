// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../lib/api.ts';
import { CalendarSettings } from './CalendarSettings.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const modules = vi.hoisted(() => ({ off: [] as string[] }));
vi.mock('../lib/modules.ts', async () => {
  const { offered } = await import('@inkadra/shared');
  return {
    useModules: () => ({ offers: (part: 'calendar', name: string) => offered(modules.off, part, name) }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  modules.off = [];
});

it.each([
  [[], true],
  [['production'], false],
])('lists shooting days only while Production is on (off: %j)', async (off, shown) => {
  modules.off = off;
  vi.spyOn(api, 'get').mockResolvedValue({ enabled: true, url: 'https://x/calendar/t.ics' });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<CalendarSettings />));
  expect(host.textContent?.includes('calendar.shooting')).toBe(shown);
  expect(host.textContent).toContain('calendar.tasks');
  await act(async () => root.unmount());
  host.remove();
});
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
