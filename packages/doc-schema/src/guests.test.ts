// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  Element,
  GUEST_ELEMENT_FIELDS,
  hiddenFromGuests,
  toGuestElement,
  UNSORTED,
} from './index.ts';

describe('guest visibility', () => {
  const elements: Record<string, { guestHidden?: boolean; parent: string | null }> = {
    column: { guestHidden: true, parent: null },
    inside: { parent: 'column' },
    deeper: { parent: 'inside' },
    shown: { parent: null },
    shownColumn: { guestHidden: false, parent: null },
    inShownColumn: { parent: 'shownColumn' },
    inUnsorted: { parent: UNSORTED },
    unsortedColumn: { parent: UNSORTED },
    inUnsortedColumn: { parent: 'unsortedColumn' },
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
  });

  it('hides cards whose chain of containers reaches the unsorted tray', () => {
    expect(hiddenFromGuests('inUnsorted', lookup)).toBe(true);
    expect(hiddenFromGuests('inUnsortedColumn', lookup)).toBe(true);
  });

  it('hides elements with a missing or circular parent chain', () => {
    expect(hiddenFromGuests('orphan', lookup)).toBe(true);
    expect(hiddenFromGuests('loopA', lookup)).toBe(true);
    expect(hiddenFromGuests('missing', lookup)).toBe(true);
  });
});

describe('guest element fields', () => {
  // Fields guests never receive; every other field must be listed in GUEST_ELEMENT_FIELDS, so
  // a field added to an element needs a decision before guests see it.
  const omitted: Record<string, readonly string[]> = {
    common: ['tags', 'locked', 'guestHidden'],
    frame: ['status', 'notes'],
  };

  it('decides for every field of every element type', () => {
    for (const option of Element.options) {
      const type = option.shape.type.value;
      const allowed: readonly string[] = GUEST_ELEMENT_FIELDS[type];
      const left = [...(omitted.common ?? []), ...(omitted[type] ?? [])];
      for (const key of Object.keys(option.shape)) {
        expect(allowed.includes(key) !== left.includes(key), `${type}.${key}`).toBe(true);
      }
      for (const key of allowed) expect(Object.keys(option.shape)).toContain(key);
    }
  });

  it('shares file captions like image captions without exposing internal fields', () => {
    for (const type of ['file', 'image'] as const) {
      const element = Element.parse({
        id: 'V1StGXR8_Z5jdHi6B-myT',
        type,
        x: 0,
        y: 0,
        w: 240,
        z: 'a0',
        parent: null,
        createdBy: 'user-1',
        createdAt: 1,
        assetId: 'asset-id',
        caption: 'Call sheet',
        tags: ['internal'],
        locked: true,
      });
      const guest = toGuestElement(element);
      expect(guest).toMatchObject({
        type,
        assetId: 'asset-id',
        caption: 'Call sheet',
        createdBy: null,
      });
      expect(guest).not.toHaveProperty('tags');
      expect(guest).not.toHaveProperty('locked');
      expect(Element.parse(guest)).toEqual(guest);
      const { caption: _caption, ...legacy } = element as typeof element & { caption?: string };
      expect(toGuestElement(legacy)).not.toHaveProperty('caption');
    }
  });

  it('drops tags, locks and production fields, and the author', () => {
    const frame = Element.parse({
      id: 'V1StGXR8_Z5jdHi6B-myT',
      type: 'frame',
      x: 0,
      y: 0,
      w: 320,
      z: 'a0',
      parent: null,
      locked: true,
      tags: ['cliente difficile'],
      createdBy: 'user-1',
      createdAt: 1,
      action: 'Lei apre la porta',
      notes: 'Rifare con più luce',
      status: 'retake',
    });
    const guest = toGuestElement(frame);
    expect(guest).toEqual({
      id: 'V1StGXR8_Z5jdHi6B-myT',
      type: 'frame',
      x: 0,
      y: 0,
      w: 320,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: 1,
      action: 'Lei apre la porta',
    });
    expect(Element.parse(guest)).toEqual(guest);
  });
});
