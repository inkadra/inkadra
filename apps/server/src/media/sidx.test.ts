import { describe, expect, it } from 'vitest';
import { mediaPlaylist, parseFragmentIndex } from './sidx.ts';

const box = (type: string, body: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

/** A sidx (version 0, timescale 1000) over fragments of these bytes and milliseconds. */
function sidx(refs: Array<[number, number]>, firstOffset = 0) {
  const body = Buffer.alloc(24 + refs.length * 12);
  body.writeUInt32BE(1, 4); // reference_ID
  body.writeUInt32BE(1000, 8); // timescale
  body.writeUInt32BE(firstOffset, 16);
  body.writeUInt16BE(refs.length, 22);
  refs.forEach(([bytes, ms], i) => {
    body.writeUInt32BE(bytes, 24 + i * 12);
    body.writeUInt32BE(ms, 28 + i * 12);
    body.writeUInt32BE(0x90000000, 32 + i * 12);
  });
  return box('sidx', body);
}

describe('parseFragmentIndex', () => {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0'));
  const moov = box('moov', Buffer.alloc(100));
  const refs: Array<[number, number]> = [
    [4_000_000, 4000],
    [2_000_000, 4000],
    [50_000, 120],
  ];
  const head = Buffer.concat([ftyp, moov, sidx(refs)]);
  const fragments = refs.reduce((sum, [bytes]) => sum + bytes, 0);

  it('finds the header and each fragment, and the peak of whole seconds', () => {
    const index = parseFragmentIndex(head, head.length + fragments + 200);
    expect(index.initBytes).toBe(ftyp.length + moov.length);
    expect(index.fragments).toEqual([
      { offset: head.length, bytes: 4_000_000, seconds: 4 },
      { offset: head.length + 4_000_000, bytes: 2_000_000, seconds: 4 },
      { offset: head.length + 6_000_000, bytes: 50_000, seconds: 0.12 },
    ]);
    // 4 MB in 4 s; the last sliver of 0.12 s does not count.
    expect(index.peak).toBe(8_000_000);
    expect(index.seconds).toBeCloseTo(8.12);
  });

  it('refuses an index that does not match the file', () => {
    expect(() => parseFragmentIndex(head, head.length + fragments - 1)).toThrow(/ends at/);
    expect(() => parseFragmentIndex(head, head.length + fragments + 2 * 1024 * 1024)).toThrow();
    expect(() => parseFragmentIndex(Buffer.concat([ftyp, moov]), 1000)).toThrow(/no fragment/);
  });

  it('writes a byte-range playlist with relative URIs', () => {
    const index = parseFragmentIndex(head, head.length + fragments);
    const text = mediaPlaylist(index, '720.mp4?v=abc123');
    expect(text.split('\n').slice(0, 9)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-MAP:URI="720.mp4?v=abc123",BYTERANGE="${ftyp.length + moov.length}@0"`,
      '#EXTINF:4.000,',
      `#EXT-X-BYTERANGE:4000000@${head.length}`,
      '720.mp4?v=abc123',
    ]);
    expect(text.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });
});
