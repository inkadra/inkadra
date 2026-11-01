// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatClimb, formatDistance, openInMapsUrl } from './maps.ts';

describe('map cards', () => {
  it('opens the original link, else OpenStreetMap at the place or the address', () => {
    expect(openInMapsUrl({ url: 'https://maps.app.goo.gl/x', name: '' })).toBe(
      'https://maps.app.goo.gl/x',
    );
    expect(openInMapsUrl({ lat: 46.3, lon: 9.5, zoom: 14, name: 'Lagunc' })).toBe(
      'https://www.openstreetmap.org/?mlat=46.3&mlon=9.5#map=14/46.3/9.5',
    );
    expect(openInMapsUrl({ name: 'Loreto', address: 'Via Roma 1, Sondrio' })).toBe(
      'https://www.openstreetmap.org/search?query=Via%20Roma%201%2C%20Sondrio',
    );
    expect(openInMapsUrl({ url: 'javascript:alert(1)', name: '' })).toBeNull();
  });

  it('formats lengths and climbs as on the mockup', () => {
    expect(formatDistance(25_040, 'it')).toBe('25 km');
    expect(formatDistance(2_420, 'it')).toBe('2,4 km');
    expect(formatDistance(850, 'it')).toBe('850 m');
    expect(formatClimb(1049.6)).toBe('+1050 m');
  });
});
