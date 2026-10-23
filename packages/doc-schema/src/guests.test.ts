// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { hiddenFromGuests } from './index.ts';

describe('guest visibility', () => {
  const elements: Record<string, { guestHidden?: boolean; parent: string | null }> = {
    column: { guestHidden: true, parent: null },
    inside: { parent: 'column' },
    deeper: { parent: 'inside' },
    shown: { parent: null },
    unsorted: { parent: 'unsorted' },
    loopA: { parent: 'loopB' },
    loopB: { parent: 'loopA' },
  };
  const lookup = (id: string) => elements[id];

  it('hides an element and everything inside it', () => {
    expect(hiddenFromGuests('column', lookup)).toBe(true);
    expect(hiddenFromGuests('inside', lookup)).toBe(true);
    expect(hiddenFromGuests('deeper', lookup)).toBe(true);
  });

  it('shows elements nobody hid, also with a broken or circular parent chain', () => {
    expect(hiddenFromGuests('shown', lookup)).toBe(false);
    expect(hiddenFromGuests('unsorted', lookup)).toBe(false);
    expect(hiddenFromGuests('loopA', lookup)).toBe(false);
  });
});
