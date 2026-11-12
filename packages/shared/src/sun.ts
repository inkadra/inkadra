// SPDX-License-Identifier: MPL-2.0
import { parseMapLink } from './maps.ts';
import type { ShootingDay } from './schedule.ts';

/**
 * Sunrise and sunset, worked out on the device from the coordinates of a map link (decision
 * 0089): no request leaves the browser. The standard sunrise equation (NOAA's simplified form,
 * about a minute off at mid latitudes) with the usual −0.833° for refraction and the sun's disc.
 */

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;

/**
 * Sunrise and sunset in minutes from 00:00 UTC of `date` (YYYY-MM-DD); null when the sun does
 * not rise or set that day (polar day or night).
 */
export function sunTimesUtc(
  date: string,
  lat: number,
  lng: number,
): { sunrise: number | null; sunset: number | null } {
  const noon = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(noon)) return { sunrise: null, sunset: null };
  // Days since J2000 at noon UTC: Julian days start at noon, so the noon of `date` is whole.
  const n = Math.round(noon / 86_400_000 + J1970 - J2000);
  const mean = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * mean) % 360;
  const m = anomaly * RAD;
  const centre = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const ecliptic = ((anomaly + centre + 180 + 102.9372) % 360) * RAD;
  const transit = J2000 + mean + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * ecliptic);
  const declination = Math.asin(Math.sin(ecliptic) * Math.sin(23.4397 * RAD));
  const cosHour =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(declination)) /
    (Math.cos(lat * RAD) * Math.cos(declination));
  if (cosHour > 1 || cosHour < -1) return { sunrise: null, sunset: null };
  const hour = Math.acos(cosHour) / RAD / 360;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const minutes = (julian: number) =>
    Math.round(((julian - J1970) * 86_400_000 - midnight) / 60_000);
  return { sunrise: minutes(transit - hour), sunset: minutes(transit + hour) };
}

/**
 * The time zone the shooting times are written in: the project's (decision 0061), "UTC" included.
 * A project made before the web app sent its zone has none, and the device's zone stands in.
 * shortcut: a location in another zone than the project needs a zone per day or per location,
 * and a setting to change the project's zone.
 */
export function shootingZone(projectZone: string | null | undefined): string | undefined {
  return projectZone || undefined;
}

/** Minutes the wall clock of `timeZone` (the device's when none) is ahead of UTC at `at`. */
function zoneOffset(at: number, timeZone: string | undefined): number {
  if (!timeZone) return -new Date(at).getTimezoneOffset();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(at);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    );
    return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000);
  } catch {
    // A zone this browser does not know: the device's clock, as before.
    return -new Date(at).getTimezoneOffset();
  }
}

/**
 * Sunrise and sunset in minutes from midnight of `date` on the clock of `timeZone` (the project's,
 * see `shootingZone`), else on the device's; null for polar day or night.
 */
export function sunTimes(
  date: string,
  lat: number,
  lng: number,
  timeZone?: string | undefined,
): { sunrise: number | null; sunset: number | null } {
  const utc = sunTimesUtc(date, lat, lng);
  const [y = 0, mo = 1, d = 1] = date.split('-').map(Number);
  const local = (minutes: number | null) => {
    if (minutes === null) return null;
    const at = Date.UTC(y, mo - 1, d) + minutes * 60_000;
    return minutes + zoneOffset(at, timeZone);
  };
  return { sunrise: local(utc.sunrise), sunset: local(utc.sunset) };
}

/**
 * The coordinates of the first map link in a location's text (Google, Apple Maps or
 * OpenStreetMap, with or without https://), read without the network (decision 0053).
 */
export function locationCoords(text: string): { lat: number; lng: number } | null {
  for (const word of text.split(/\s+/)) {
    const token = word.replace(/^[<(]+|[>),.;]+$/g, '');
    if (!token) continue;
    const found =
      parseMapLink(token) ?? (/^https?:/i.test(token) ? null : parseMapLink(`https://${token}`));
    if (found) return { lat: found.lat, lng: found.lon };
  }
  return null;
}

/**
 * Where the sun is at `minutes` after midnight of `date` on the clock of `timeZone` (the
 * device's when none), seen from `lat`, `lng`: its bearing in degrees clockwise from north and
 * its height above the horizon in degrees. The usual low-precision solar position (about a
 * degree off), worked out on the device as `sunTimesUtc` is (decision 0089).
 */
export function sunPosition(
  date: string,
  minutes: number,
  lat: number,
  lng: number,
  timeZone?: string | undefined,
): { azimuth: number; elevation: number } {
  const [y = 2000, mo = 1, d = 1] = date.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d) + minutes * 60_000;
  const at = wall - zoneOffset(wall, timeZone) * 60_000;
  const days = at / 86_400_000 + J1970 - J2000;
  const m = (357.5291 + 0.98560028 * days) * RAD;
  const centre = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
  const ecliptic = m + centre + 102.9372 * RAD + Math.PI;
  const tilt = 23.4397 * RAD;
  const declination = Math.asin(Math.sin(ecliptic) * Math.sin(tilt));
  const ascension = Math.atan2(Math.sin(ecliptic) * Math.cos(tilt), Math.cos(ecliptic));
  const hour = (280.16 + 360.9856235 * days) * RAD + lng * RAD - ascension;
  const phi = lat * RAD;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hour),
  );
  // Measured from the south, westwards; turned to a bearing from the north.
  const fromSouth = Math.atan2(
    Math.sin(hour),
    Math.cos(hour) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
  );
  const azimuth = (((fromSouth / RAD + 180) % 360) + 360) % 360;
  return { azimuth: Math.round(azimuth), elevation: Math.round(elevation / RAD) };
}

/**
 * The sun's bearing from the clock alone, for a set whose place is not known: east at six,
 * south at noon, west at six in the evening, as north of the tropics. shortcut: no latitude nor
 * season; a location with a map link gives `sunPosition` instead, and an address would need a
 * geocoder.
 */
export function sunBearingByClock(minutes: number): number {
  return (((180 + (minutes / 60 - 12) * 15) % 360) + 360) % 360;
}

/** A shooting day the sun's date can follow: its id, its number in the shoot and its date. */
export interface SunDay {
  id: string;
  n: number;
  date: string;
}

type Day = Pick<ShootingDay, 'id' | 'date' | 'blocks'>;

/**
 * The days the sun's date can be (decision 0119): the shooting days of the board's schedule,
 * numbered as ScheduleView numbers them (by date, from 1). When `shots` (the frames of the plan's
 * scenes) or `scenes` (a scene block plans one of them, decision 0123) is not empty, only the
 * days that shoot one of them; all of them when both are, or when no day shoots them yet.
 */
export function sunDays(
  days: readonly Day[],
  shots: ReadonlySet<string>,
  scenes: ReadonlySet<string> = new Set(),
): SunDay[] {
  const all = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d, i) => ({ id: d.id, n: i + 1, date: d.date, blocks: d.blocks }));
  const ofScenes = all.filter((d) =>
    d.blocks.some((b) => (b.shotId && shots.has(b.shotId)) || (b.sceneId && scenes.has(b.sceneId))),
  );
  return (ofScenes.length ? ofScenes : all).map(({ id, n, date }) => ({ id, n, date }));
}

/** Eight ways north can point, from the top of the drawing clockwise, for "Up, 0°". */
export const NORTH_WAYS = [
  'up',
  'upRight',
  'right',
  'downRight',
  'down',
  'downLeft',
  'left',
  'upLeft',
] as const;

/** The way north points at `degrees`: the nearest of NORTH_WAYS. */
export function northWay(degrees: number): (typeof NORTH_WAYS)[number] {
  return NORTH_WAYS[
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  ] as (typeof NORTH_WAYS)[number];
}

/** The rotation of a sun icon that shines from `bearing` on a plan whose north is `north`. */
export function sunRotation(bearing: number, north: number): number {
  return Math.round((((north + bearing + 90) % 360) + 360) % 360);
}

/** Where the sun shines from, by the nearest of eight points of the compass from the north. */
export const SUN_FROM = [
  'north',
  'northEast',
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
] as const;

/** The point of the compass the sun shines from at `bearing` (degrees from the north). */
export function sunFrom(bearing: number): (typeof SUN_FROM)[number] {
  return SUN_FROM[Math.round(bearing / 45) % 8] as (typeof SUN_FROM)[number];
}

/** How high the sun is, as the plan says it: below the horizon, low, half way up or high. */
export function sunHeight(elevation: number): 'down' | 'low' | 'mid' | 'high' {
  return elevation <= 0 ? 'down' : elevation < 20 ? 'low' : elevation < 50 ? 'mid' : 'high';
}

/**
 * The date a plan's sun stands on (decision 0119): the live date of the shooting day it follows
 * (`sun.day`), else the date it stored. `gone` when the days are known and the day it followed
 * is no longer among them: the plan keeps its last date. `all` is null until the days are read.
 */
export function sunDate(
  sun: { day?: string | undefined; date?: string | undefined } | undefined,
  all: readonly SunDay[] | null,
): { date: string | undefined; day: SunDay | undefined; gone: boolean } {
  const day = sun?.day ? all?.find((d) => d.id === sun.day) : undefined;
  return { date: day?.date ?? sun?.date, day, gone: !!sun?.day && !!all && !day };
}
