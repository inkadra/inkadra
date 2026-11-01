import { expect, it } from 'vitest';
import { taskGroup } from './MyTasks.tsx';

it('groups calendar dates without UTC shifts', () => {
  const now = new Date(2026, 10, 1, 23, 59);
  expect(taskGroup('2026-10-31', now)).toBe('overdue');
  expect(taskGroup('2026-11-01', now)).toBe('today');
  expect(taskGroup('2026-11-06', now)).toBe('week');
  expect(taskGroup('2026-12-01', now)).toBe('later');
  expect(taskGroup(undefined, now)).toBe('undated');
});
