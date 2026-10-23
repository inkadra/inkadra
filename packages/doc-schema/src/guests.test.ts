// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { hiddenFromGuests, UNSORTED } from './index.ts';

describe('guest visibility', () => {
  const elements: Record<string, { guestHidden?: boolean; parent: string | null }> = {
    column: { guestHidden: true, parent: null },
    inside: { parent: 'column' },
    deeper: { parent: 'inside' },
    shown: { parent: null },
    shownColumn: { guestHidden: false, parent: null },
    inShownColumn: { parent: 'shownColumn' },
    unsorted: { parent: UNSORTED },
    orphan: { parent: 'deletedColumn' },
    loopA: { parent: 'loopB' },
    loopB: { parent: 'loopA' },
  };
  const lookup = (id: string) => elements[id];

  it('hides an element and everything inside it', () => {
    expect(hiddenFromGuests('column', lookup)).toBe(true);
    expect(hiddenFromGuests('inside', lookup)).toBe(true);
    expect(hiddenFromGuests('deeper', lookup)).toBe(true);
  });

  it('shows elements nobody hid', () => {
    expect(hiddenFromGuests('shown', lookup)).toBe(false);
    expect(hiddenFromGuests('inShownColumn', lookup)).toBe(false);
    expect(hiddenFromGuests('unsorted', lookup)).toBe(false);
  });

  it('hides elements with a missing or circular parent chain', () => {
    expect(hiddenFromGuests('orphan', lookup)).toBe(true);
    expect(hiddenFromGuests('loopA', lookup)).toBe(true);
    expect(hiddenFromGuests('missing', lookup)).toBe(true);
  });
});
