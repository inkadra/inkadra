// @vitest-environment happy-dom
import type { ShootingDay } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { ScheduleView } from './ScheduleView.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

it.each([false, true])("names the day's place without the map link (phone: %s)", async (phone) => {
  vi.stubGlobal(
    'matchMedia',
    () =>
      ({
        matches: phone,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const day: ShootingDay = {
    id: crypto.randomUUID(),
    boardId: 'board',
    projectId: crypto.randomUUID(),
    revision: 1,
    date: '2026-11-02',
    callTime: '08:00',
    wrap: null,
    location:
      'Faro di Punta Palascia, Otranto https://www.openstreetmap.org/#map=16/40.1046/18.5196',
    notes: '',
    blocks: [],
  };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ScheduleView store={store} boardId="board" />));
  // A computer heads the day column; a phone shows the day on its summary card.
  const heading = host.querySelector(phone ? '.schedule__summary-card b' : '.schedule__day-sub');
  expect(heading?.textContent).toBe('schedule.dayShort · Faro di Punta Palascia, Otranto');
  act(() => root.unmount());
  host.remove();
  store.destroy();
  doc.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
