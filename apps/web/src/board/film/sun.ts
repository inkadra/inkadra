// SPDX-License-Identifier: AGPL-3.0-only
import { parseMapLink } from '@inkadra/shared';

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
 * The time zone the shooting times are written in: the project's (decision 0061).
 * shortcut: "UTC" is also the default of every project made before the web app sent its zone, so
 * it reads as "not set" and the device's zone stands in; a location in another zone than the
 * project needs a zone per day or per location, and a way to change the project's zone.
 */
export function shootingZone(projectZone: string | undefined): string | undefined {
  return projectZone && projectZone !== 'UTC' ? projectZone : undefined;
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
