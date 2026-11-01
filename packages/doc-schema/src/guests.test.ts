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
    frame: ['status', 'notes', 'approved', 'source'],
    image: ['source'],
    character: ['contact', 'notes'],
    location: ['address', 'mapUrl', 'availability', 'contact', 'notes'],
    // How the heading moves while editing; guests only look.
    section: ['moveCards'],
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

  it('keeps image crop and rotation in guest snapshots', () => {
    const image = Element.parse({
      id: 'V1StGXR8_Z5jdHi6B-myT',
      type: 'image',
      x: 0,
      y: 0,
      w: 240,
      z: 'a0',
      parent: null,
      createdBy: 'user-1',
      createdAt: 1,
      assetId: 'asset-id',
      crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6, aspect: '16:9' },
      rotation: 90,
      tags: ['internal'],
    });
    const guest = toGuestElement(image);
    expect(guest).toMatchObject({
      type: 'image',
      assetId: 'asset-id',
      crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6, aspect: '16:9' },
      rotation: 90,
      createdBy: null,
    });
    expect(guest).not.toHaveProperty('tags');
    expect(Element.parse(guest)).toEqual(guest);
  });

  it('never exposes video provenance to guests', () => {
    for (const type of ['image', 'frame'] as const) {
      const element = Element.parse({
        id: 'V1StGXR8_Z5jdHi6B-myT',
        type,
        x: 0,
        y: 0,
        w: 240,
        z: 'a0',
        parent: null,
        createdBy: null,
        createdAt: 0,
        assetId: 'still',
        source: {
          kind: 'uploaded-video',
          assetId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
          timeSeconds: 0,
        },
      });
      expect(toGuestElement(element)).not.toHaveProperty('source');
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

  it('sets a computed shot label on frames when provided', () => {
    const frame = Element.parse({
      id: 'V1StGXR8_Z5jdHi6B-myT',
      type: 'frame',
      x: 0,
      y: 0,
      w: 320,
      z: 'a0',
      parent: null,
      createdBy: 'user-1',
      createdAt: 1,
    });
    const guestWithLabel = toGuestElement(frame, '1C');
    expect(guestWithLabel.label).toBe('1C');
    expect(Element.parse(guestWithLabel)).toEqual(guestWithLabel);

    const guestWithoutLabel = toGuestElement(frame);
    expect(guestWithoutLabel).not.toHaveProperty('label');
  });

  it('keeps contacts, notes and private addresses of story bible cards from guests', () => {
    const common = {
      id: 'V1StGXR8_Z5jdHi6B-myT',
      x: 0,
      y: 0,
      w: 260,
      z: 'a0',
      parent: null,
      createdBy: 'user-1',
      createdAt: 1,
    };
    const leo = toGuestElement(
      Element.parse({
        ...common,
        type: 'character',
        name: 'Leo',
        role: 'Guardiano',
        actor: 'Marco Riva',
        contact: '+39 333 000 0000',
        notes: 'Chiede il cachet in anticipo',
        scenes: ['2'],
      }),
    );
    expect(leo).toMatchObject({ name: 'Leo', role: 'Guardiano', actor: 'Marco Riva' });
    expect(leo).not.toHaveProperty('contact');
    expect(leo).not.toHaveProperty('notes');
    expect(Element.parse(leo)).toEqual(leo);
    const cabin = toGuestElement(
      Element.parse({
        ...common,
        type: 'location',
        name: 'Cabina del guardiano',
        setting: 'int',
        address: 'Via dei Binari 4',
        mapUrl: 'https://www.openstreetmap.org/',
        availability: 'Weekend',
        contact: 'Sig. Rossi',
        notes: 'Chiavi in portineria',
        light: 'Neon verde',
      }),
    );
    expect(Object.keys(cabin).sort()).toEqual(
      [...Object.keys(common), 'type', 'name', 'setting', 'light'].sort(),
    );
    expect(Element.parse(cabin)).toEqual(cabin);
  });
});
