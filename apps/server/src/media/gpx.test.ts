import { describe, expect, it } from 'vitest';
import { haversine, parseGpx, trackStats } from './gpx.ts';

const gpx = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe('GPX', () => {
  it('reads track segments and routes, with elevations', () => {
    const segments = parseGpx(
      gpx(`<trk><name>Val Bregaglia</name><trkseg>
        <trkpt lat="46.30" lon="9.50"><ele>1000</ele></trkpt>
        <trkpt lat="46.31" lon="9.51"><ele> 1010.5 </ele></trkpt>
      </trkseg><trkseg><trkpt lat="46.32" lon="9.52"/></trkseg></trk>
      <rte><rtept lat="45" lon="9"/><rtept lat="bad" lon="9"/></rte>`),
    );
    expect(segments).toEqual([
      [
        { lat: 46.3, lon: 9.5, ele: 1000 },
        { lat: 46.31, lon: 9.51, ele: 1010.5 },
      ],
      [{ lat: 46.32, lon: 9.52 }],
      [{ lat: 45, lon: 9 }],
    ]);
  });

  it('never loads external entities or a DTD', () => {
    const evil = `<?xml version="1.0"?>
      <!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY big "aaaaaaaaaa">]>
      <gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>&xxe;&big;</ele></trkpt></trkseg></trk></gpx>`;
    // The entities stay unexpanded text, so the elevation is simply not a number.
    expect(parseGpx(evil)).toEqual([[{ lat: 1, lon: 2 }]]);
  });

  it('caps the number of segments, later points joining the last', () => {
    const many = '<trkseg><trkpt lat="1" lon="2"/></trkseg>'.repeat(10_005);
    const segments = parseGpx(gpx(`<trk>${many}</trk>`));
    expect(segments).toHaveLength(10_000);
    expect(segments.at(-1)).toHaveLength(6);
  });

  it('reads prefixed tags and ignores waypoints', () => {
    expect(
      parseGpx(
        '<gpx:gpx><gpx:wpt lat="1" lon="1"/><gpx:trkseg><gpx:trkpt lat="3" lon="4"/></gpx:trkseg></gpx:gpx>',
      ),
    ).toEqual([[{ lat: 3, lon: 4 }]]);
  });

  it('measures the length and the climb, ignoring GPS jitter', () => {
    // One degree of latitude is about 111.2 km.
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -2);
    const climb = [1000, 1001, 1000, 1002, 1010, 1008, 1030, 1029, 1000].map((ele, i) => ({
      lat: 46 + i * 0.001,
      lon: 9,
      ele,
    }));
    const stats = trackStats([climb]);
    // 1000 → 1010 → 1030 counted (30 m); the 1–2 m wobbles are not.
    expect(stats.elevationGainM).toBe(30);
    expect(stats.distanceM).toBe(Math.round(8 * haversine(climb[0]!, climb[1]!)));
    expect(
      trackStats([
        [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
        ],
      ]).elevationGainM,
    ).toBeNull();
  });
});
