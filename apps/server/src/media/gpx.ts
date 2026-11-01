import { Parser } from 'htmlparser2';

/**
 * GPX files are untrusted XML. htmlparser2 reads them as a stream of tags: it never loads a
 * DTD or an external entity and decodes only the predefined entities, so a file cannot make
 * the server fetch or expand anything. Size and point limits keep the work bounded.
 */

/** Largest GPX file the worker reads; bigger ones stay plain files. */
export const GPX_MAX_BYTES = 20 * 1024 * 1024;
/** Points read from one file; the rest are ignored. */
export const GPX_MAX_POINTS = 200_000;
/** Segments of one file; points of later ones join the last. */
export const GPX_MAX_SEGMENTS = 10_000;
/** Rises under this are GPS noise, not climbing (hysteresis on elevation). */
const CLIMB_THRESHOLD_M = 3;

export interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
}

/** Segments of a track (`trkseg`) or route (`rte`), in file order. */
export function parseGpx(xml: string): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] | null = null;
  let point: TrackPoint | null = null;
  let inEle = false;
  let ele = '';
  let count = 0;
  // Past the cap, points join the last segment.
  const newSegment = (): TrackPoint[] => {
    const last = segments.at(-1);
    if (last && segments.length >= GPX_MAX_SEGMENTS) return last;
    const seg: TrackPoint[] = [];
    segments.push(seg);
    return seg;
  };
  const local = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();
  const parser = new Parser(
    {
      onopentag(raw, attrs) {
        const name = local(raw);
        if (name === 'trkseg' || name === 'rte') {
          current = newSegment();
        } else if ((name === 'trkpt' || name === 'rtept') && count < GPX_MAX_POINTS) {
          const lat = Number(attrs.lat);
          const lon = Number(attrs.lon);
          if (
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180
          ) {
            point = { lat, lon };
            current ??= newSegment();
            current.push(point);
            count++;
          }
        } else if (name === 'ele' && point) {
          inEle = true;
          ele = '';
        }
      },
      ontext(text) {
        if (inEle) ele += text;
      },
      onclosetag(raw) {
        const name = local(raw);
        if (name === 'ele' && inEle) {
          inEle = false;
          const value = Number(ele.trim());
          if (point && ele.trim() && Number.isFinite(value)) point.ele = value;
        } else if (name === 'trkpt' || name === 'rtept') point = null;
        else if (name === 'trkseg' || name === 'rte') current = null;
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return segments.filter((s) => s.length > 0);
}

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: TrackPoint, b: TrackPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Length of the track and its climb. Elevations move a reference only once they are 3 m
 * above it (a climb, counted) or below it (a descent), so GPS jitter on the flat adds nothing;
 * null when no point has an elevation.
 */
export function trackStats(segments: TrackPoint[][]): {
  distanceM: number;
  elevationGainM: number | null;
} {
  let distance = 0;
  let gain = 0;
  let any = false;
  for (const seg of segments) {
    let ref: number | undefined;
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i] as TrackPoint;
      if (i > 0) distance += haversine(seg[i - 1] as TrackPoint, p);
      if (p.ele === undefined) continue;
      any = true;
      if (ref === undefined || ref - p.ele >= CLIMB_THRESHOLD_M) ref = p.ele;
      else if (p.ele - ref >= CLIMB_THRESHOLD_M) {
        gain += p.ele - ref;
        ref = p.ele;
      }
    }
  }
  return { distanceM: Math.round(distance), elevationGainM: any ? Math.round(gain) : null };
}
