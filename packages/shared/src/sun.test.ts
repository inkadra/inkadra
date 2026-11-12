// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  locationCoords,
  northWay,
  shootingZone,
  sunBearingByClock,
  sunDate,
  sunDays,
  sunFrom,
  sunHeight,
  sunPosition,
  sunRotation,
  sunTimes,
  sunTimesUtc,
} from './sun.ts';

const london = { lat: 51.5072, lng: -0.1276 };

describe('sunrise and sunset', () => {
  it('matches the published times within a minute', () => {
    // London: 03:43 and 20:21 UTC at the June solstice, 08:04 and 15:53 at the December one.
    const june = sunTimesUtc('2026-06-21', london.lat, london.lng);
    const december = sunTimesUtc('2026-12-21', london.lat, london.lng);
    expect(june.sunrise).toBeCloseTo(3 * 60 + 43, -0.5);
    expect(june.sunset).toBeCloseTo(20 * 60 + 21, -0.5);
    expect(december.sunrise).toBeCloseTo(8 * 60 + 4, -0.5);
    expect(december.sunset).toBeCloseTo(15 * 60 + 53, -0.5);
  });

  it('keeps the local day far east: Sydney rises the evening before in UTC', () => {
    const { sunrise, sunset } = sunTimesUtc('2026-03-20', -33.87, 151.21);
    // 06:58 and 19:08 in Sydney (UTC+11).
    expect(sunrise).toBeCloseTo(-(4 * 60 + 2), -0.5);
    expect(sunset).toBeCloseTo(8 * 60 + 8, -0.5);
  });

  it('has no times in the polar night or the midnight sun', () => {
    expect(sunTimesUtc('2026-12-21', 69.65, 18.96)).toEqual({ sunrise: null, sunset: null });
    expect(sunTimesUtc('2026-06-21', 69.65, 18.96)).toEqual({ sunrise: null, sunset: null });
    expect(sunTimesUtc('not a date', 45, 7)).toEqual({ sunrise: null, sunset: null });
  });

  it('turns UTC into the clock of the device', () => {
    const utc = sunTimesUtc('2026-11-09', 45.0703, 7.521);
    const local = sunTimes('2026-11-09', 45.0703, 7.521);
    const offset = new Date(2026, 10, 9).getTimezoneOffset();
    expect(local.sunrise).toBe((utc.sunrise ?? 0) - offset);
    expect(local.sunset).toBe((utc.sunset ?? 0) - offset);
  });

  it('uses the project time zone, whatever the device says, summer time included', () => {
    const turin = sunTimesUtc('2026-11-09', 45.0703, 7.521);
    expect(sunTimes('2026-11-09', 45.0703, 7.521, 'Europe/Rome')).toEqual({
      sunrise: (turin.sunrise ?? 0) + 60,
      sunset: (turin.sunset ?? 0) + 60,
    });
    const summer = sunTimesUtc('2026-07-01', 45.0703, 7.521);
    expect(sunTimes('2026-07-01', 45.0703, 7.521, 'Europe/Rome').sunrise).toBe(
      (summer.sunrise ?? 0) + 120,
    );
    // New York in November: five hours behind UTC, about 06:35 and 16:40.
    const nyc = sunTimes('2026-11-09', 40.71, -74.0, 'America/New_York');
    expect(nyc.sunrise).toBe((sunTimesUtc('2026-11-09', 40.71, -74.0).sunrise ?? 0) - 300);
    expect(Math.floor((nyc.sunrise ?? 0) / 60)).toBe(6);
    expect(Math.floor((nyc.sunset ?? 0) / 60)).toBe(16);
  });

  it('keeps an explicit UTC and falls back to the device only without a zone', () => {
    expect(shootingZone('UTC')).toBe('UTC');
    expect(sunTimes('2026-11-09', 51.5, 0, 'UTC')).toEqual(sunTimesUtc('2026-11-09', 51.5, 0));
    expect(shootingZone(undefined)).toBeUndefined();
    expect(shootingZone('Europe/Rome')).toBe('Europe/Rome');
  });
});

describe('coordinates in a location', () => {
  it('reads the first map link, with or without https', () => {
    expect(
      locationCoords('Stazione\nVia della Ferrovia 2\nopenstreetmap.org/#map=17/45.0703/7.5210'),
    ).toEqual({ lat: 45.0703, lng: 7.521 });
    expect(locationCoords('Bar (https://www.google.com/maps/@45.46,9.19,15z).')).toEqual({
      lat: 45.46,
      lng: 9.19,
    });
  });

  it('finds nothing in plain text or in other links', () => {
    expect(locationCoords('Via Roma 4, Torino')).toBeNull();
    expect(locationCoords('https://example.com/@45.4,9.1')).toBeNull();
    expect(locationCoords('')).toBeNull();
  });
});

describe('where the sun is, for a set plan', () => {
  it('stands south and high at noon in June, north-west and on the horizon at sunset', () => {
    const noon = sunPosition('2026-06-21', 12 * 60 + 2, london.lat, london.lng, 'UTC');
    expect(Math.abs(noon.azimuth - 180)).toBeLessThanOrEqual(2);
    expect(noon.elevation).toBeGreaterThanOrEqual(61);
    expect(noon.elevation).toBeLessThanOrEqual(63);
    const evening = sunPosition('2026-06-21', 20 * 60 + 21, london.lat, london.lng, 'UTC');
    expect(evening.azimuth).toBeGreaterThan(300);
    expect(evening.azimuth).toBeLessThan(320);
    expect(Math.abs(evening.elevation)).toBeLessThanOrEqual(1);
  });

  it('turns with the clock alone when the place is not known', () => {
    expect(sunBearingByClock(6 * 60)).toBe(90);
    expect(sunBearingByClock(12 * 60)).toBe(180);
    expect(sunBearingByClock(18 * 60)).toBe(270);
    expect(sunBearingByClock(0)).toBe(0);
  });
});

const block = (shotId: string | null) => ({
  id: `b${shotId ?? 'none'}xxxxxxx`,
  type: 'shot' as const,
  title: '',
  start: null,
  duration: 30,
  shotId,
  cast: [],
  departments: [],
});

describe('sunDays', () => {
  const days = [
    { id: 'd14', date: '2026-03-14', blocks: [block('frame2Axxxxx')] },
    { id: 'd12', date: '2026-03-12', blocks: [block('frame9Axxxxx')] },
    { id: 'd13', date: '2026-03-13', blocks: [block(null)] },
  ];

  it("numbers the days by date and keeps those that shoot the plan's scenes, with their ids", () => {
    expect(sunDays(days, new Set(['frame2Axxxxx']))).toEqual([
      { id: 'd14', n: 3, date: '2026-03-14' },
    ]);
  });

  it('offers every day when the plan serves no scene or none of its shots is scheduled', () => {
    const all = [
      { id: 'd12', n: 1, date: '2026-03-12' },
      { id: 'd13', n: 2, date: '2026-03-13' },
      { id: 'd14', n: 3, date: '2026-03-14' },
    ];
    expect(sunDays(days, new Set())).toEqual(all);
    expect(sunDays(days, new Set(['elsewherexxx']))).toEqual(all);
  });
});

describe('northWay', () => {
  it('names the nearest of eight ways, turning past a full circle', () => {
    expect(northWay(0)).toBe('up');
    expect(northWay(20)).toBe('up');
    expect(northWay(90)).toBe('right');
    expect(northWay(200)).toBe('down');
    expect(northWay(337)).toBe('upLeft');
    expect(northWay(359)).toBe('up');
    expect(northWay(-90)).toBe('left');
  });
});

describe("a plan's sun", () => {
  it('turns its icons to shine from the bearing, on a plan turned by its north', () => {
    // North up, a sun shining from the north turns a quarter; a plan's north turns it with it.
    expect(sunRotation(0, 0)).toBe(90);
    expect(sunRotation(270, 0)).toBe(0);
    expect(sunRotation(180, 90)).toBe(0);
    expect(sunRotation(-90, -45)).toBe(315);
  });

  it('says where it shines from and how high it stands', () => {
    expect([0, 44, 90, 200, 337, 359].map(sunFrom)).toEqual([
      'north',
      'northEast',
      'east',
      'south',
      'northWest',
      'north',
    ]);
    expect([-3, 0, 19, 20, 49, 50].map(sunHeight)).toEqual([
      'down',
      'down',
      'low',
      'mid',
      'mid',
      'high',
    ]);
  });

  it("follows its shooting day's live date, and keeps its last date when the day is gone", () => {
    const all = [{ id: 'd1', n: 1, date: '2026-03-14' }];
    expect(sunDate({ day: 'd1', date: '2026-03-01' }, all)).toEqual({
      date: '2026-03-14',
      day: all[0],
      gone: false,
    });
    expect(sunDate({ day: 'd9', date: '2026-03-01' }, all)).toEqual({
      date: '2026-03-01',
      day: undefined,
      gone: true,
    });
    // Before the days are read nothing is gone; a plan without a day keeps its date.
    expect(sunDate({ day: 'd9', date: '2026-03-01' }, null).gone).toBe(false);
    expect(sunDate({ date: '2026-03-02' }, all)).toEqual({
      date: '2026-03-02',
      day: undefined,
      gone: false,
    });
    expect(sunDate(undefined, all)).toEqual({ date: undefined, day: undefined, gone: false });
  });
});
