// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatClimb, formatDistance, openInMapsUrl, trackLatLngs } from './maps.ts';

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

  it('puts a route drawn on its picture back on the map', () => {
    // At zoom 2 the world is 1024 px: the middle of this picture is lat 0, lon 0.
    const view = { zoom: 2, left: 0, top: 232 };
    const at = trackLatLngs({ distanceM: 1, elevationGainM: null, points: [0.5, 0.5, 0, 0], view });
    expect(at?.[0]?.[0]).toBeCloseTo(0, 6);
    expect(at?.[0]?.[1]).toBeCloseTo(0, 6);
    expect(at?.[1]?.[1]).toBeCloseTo(-180, 6);
    // y = 232 of 1024: north of the equator, inside the Mercator world.
    expect(at?.[1]?.[0]).toBeGreaterThan(40);
    expect(trackLatLngs({ distanceM: 1, elevationGainM: null, points: [0.5, 0.5] })).toBeNull();
  });
});
