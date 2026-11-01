// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { CreateMapPreview, isMapLink, isShortMapLink, parseMapLink } from './maps.ts';

describe('map links', () => {
  it('reads Google Maps places, preferring the pin to the view', () => {
    expect(
      parseMapLink(
        'https://www.google.com/maps/place/Rifugio+Lagunc/@46.33,9.55,15z/data=!3m1!4b1!4m6!3m5!8m2!3d46.3349!4d9.5512',
      ),
    ).toEqual({ lat: 46.3349, lon: 9.5512, zoom: 15, name: 'Rifugio Lagunc' });
    expect(parseMapLink('https://maps.google.com/?q=46.1,9.2')).toEqual({
      lat: 46.1,
      lon: 9.2,
      zoom: 16,
    });
    expect(parseMapLink('https://www.google.it/maps/@45.4642,9.19,12.5z')).toEqual({
      lat: 45.4642,
      lon: 9.19,
      zoom: 13,
    });
  });

  it('reads OpenStreetMap and Apple Maps links', () => {
    expect(
      parseMapLink('https://www.openstreetmap.org/?mlat=46.33&mlon=9.55#map=14/46.3/9.5'),
    ).toEqual({ lat: 46.33, lon: 9.55, zoom: 14 });
    expect(parseMapLink('https://www.openstreetmap.org/#map=12/45.4642/9.1900')).toEqual({
      lat: 45.4642,
      lon: 9.19,
      zoom: 12,
    });
    expect(parseMapLink('https://maps.apple.com/?ll=45.46,9.19&q=Duomo&z=17')).toEqual({
      lat: 45.46,
      lon: 9.19,
      zoom: 17,
      name: 'Duomo',
    });
  });

  it('tells map links, short links and other pages apart', () => {
    expect(isMapLink('https://maps.app.goo.gl/AbCdEf')).toBe(true);
    expect(isShortMapLink('https://maps.app.goo.gl/AbCdEf')).toBe(true);
    expect(parseMapLink('https://maps.app.goo.gl/AbCdEf')).toBeNull();
    expect(isMapLink('https://www.google.com/search?q=lagunc')).toBe(false);
    expect(isMapLink('https://example.com/maps/@1,2,3z')).toBe(false);
    expect(parseMapLink('https://www.google.com/maps/@95,9,12z')).toBeNull();
  });

  it('takes a link or an address, not both', () => {
    const projectId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
    expect(CreateMapPreview.safeParse({ projectId, query: 'Loreto, Sondrio' }).success).toBe(true);
    expect(CreateMapPreview.safeParse({ projectId }).success).toBe(false);
    expect(
      CreateMapPreview.safeParse({ projectId, query: 'x', url: 'https://osm.org/' }).success,
    ).toBe(false);
  });
});
