import { describe, expect, it } from 'vitest';
import { firstCalls } from './schedule-routes.ts';

const block = (id: string, start: string, cast: string[]) => ({
  id,
  type: 'shot' as const,
  title: '',
  start,
  duration: 30,
  shotId: null,
  cast,
  departments: [],
});

describe('first call of each linked person', () => {
  it('gives every account linked to one name its own time', () => {
    const day = {
      callTime: '08:00',
      blocks: [block('a', '09:00', ['Anna']), block('b', '11:00', ['Bruno'])],
    };
    const calls = firstCalls(day, [
      { castKey: 'bruno', userId: 'one' },
      { castKey: 'bruno', userId: 'two' },
      { castKey: 'anna', userId: 'two' },
    ]);
    expect(calls.get('one')).toBe(660);
    // "two" is also Anna, earlier in the day.
    expect(calls.get('two')).toBe(540);
  });
});
