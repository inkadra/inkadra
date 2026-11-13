import { describe, expect, it } from 'vitest';
import { hlsFile, masterPlaylist, proxyRendition, type RenditionRow, toPlayback } from './hls.ts';

const row = (name: RenditionRow['name'], over: Partial<RenditionRow> = {}): RenditionRow => ({
  assetId: 'a1',
  name,
  status: 'ready',
  progress: 100,
  width: Math.round((Number(name) * 16) / 9 / 2) * 2,
  height: Number(name),
  codecs: 'avc1.640028,mp4a.40.2',
  bitrate: Number(name) * 2000,
  peakBitrate: Number(name) * 4000,
  frameRate: 25,
  bytes: 1000,
  storageKey: `variants/a1/rabcdef-${name}.mp4`,
  playlist: '#EXTM3U\n',
  recipe: 'h264/balanced/1',
  encoder: 'software',
  encodeMs: 1000,
  createdAt: new Date(0),
  ...over,
});

describe('masterPlaylist', () => {
  it('lists the ready rungs, smallest first, with peak and average rates', () => {
    const text = masterPlaylist([row('1080'), row('480'), row('720', { status: 'processing' })]);
    expect(text.split('\n')).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-STREAM-INF:BANDWIDTH=1920000,AVERAGE-BANDWIDTH=960000,RESOLUTION=854x480,FRAME-RATE=25.000,CODECS="avc1.640028,mp4a.40.2"',
      '480.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=4320000,AVERAGE-BANDWIDTH=2160000,RESOLUTION=1920x1080,FRAME-RATE=25.000,CODECS="avc1.640028,mp4a.40.2"',
      '1080.m3u8',
      '',
    ]);
  });
});

describe('toPlayback', () => {
  it('points at the master playlist once a rung is ready, and at each file', () => {
    const playback = toPlayback(
      [row('720', { status: 'processing', progress: 40, storageKey: null }), row('480')],
      '/api/v1/assets/a1/hls',
      false,
    );
    expect(playback?.hls).toMatch(/^\/api\/v1\/assets\/a1\/hls\/master\.m3u8\?v=[\w-]{8}$/);
    expect(playback?.renditions.map((r) => [r.name, r.status, r.progress, r.url])).toEqual([
      ['480', 'ready', 100, '/api/v1/assets/a1/hls/480.mp4?v=abcdef'],
      ['720', 'processing', 40, null],
    ]);
    expect(toPlayback([], '/x', true)).toBeNull();
    const waiting = toPlayback([row('480', { status: 'queued', storageKey: null })], '/x', true);
    expect(waiting?.hls).toBeNull();
    expect(waiting?.original).toBe(true);
  });
});

describe('proxyRendition', () => {
  it('serves the largest ready rung up to 1080 to older clients', () => {
    expect(proxyRendition([row('480'), row('1080'), row('2160')])?.name).toBe('1080');
    expect(proxyRendition([row('2160')])?.name).toBe('2160');
    expect(proxyRendition([row('480', { status: 'failed' })])).toBeNull();
  });
});

describe('hlsFile', () => {
  it('takes only the names of the ladder', () => {
    expect(hlsFile('master.m3u8')).toEqual({ kind: 'master' });
    expect(hlsFile('720.m3u8')).toEqual({ kind: 'playlist', rung: '720' });
    expect(hlsFile('2160.mp4')).toEqual({ kind: 'file', rung: '2160' });
    expect(hlsFile('master.mp4')).toBeNull();
    expect(hlsFile('../proxy.mp4')).toBeNull();
    expect(hlsFile('360.m3u8')).toBeNull();
  });
});
