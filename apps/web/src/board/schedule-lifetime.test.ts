// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('retains the schedule outside the conditional view tree', () => {
  const page = readFileSync(new URL('./BoardPage.tsx', import.meta.url), 'utf8');
  expect(page).toMatch(/<ScheduleView\s+active=\{view === 'schedule'\}/);
});
