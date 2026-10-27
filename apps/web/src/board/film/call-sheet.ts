// SPDX-License-Identifier: AGPL-3.0-only
import type { ShootingDayInput } from '@inkadra/shared';
import { scheduleTimes } from './schedule.ts';

/** First scheduled appearance, in local minutes from the shooting date (including overnight). */
export function castCalls(day: ShootingDayInput) {
  const calls = new Map<string, { name: string; start: number }>();
  for (const { block, start } of scheduleTimes(day)) {
    for (const value of block.cast) {
      const name = value.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      const previous = calls.get(key);
      if (!previous || start < previous.start) calls.set(key, { name, start });
    }
  }
  return [...calls.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}
