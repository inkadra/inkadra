import { open } from 'node:fs/promises';

/**
 * The index of a fragmented MP4 rendition (decision 0128): where the header ends and where each
 * fragment starts, read from the `sidx` box ffmpeg writes at the front with `global_sidx`.
 */
export interface FragmentIndex {
  /** Bytes of `ftyp` and `moov`: the HLS initialisation section. */
  initBytes: number;
  fragments: Array<{ offset: number; bytes: number; seconds: number }>;
  /** Highest bitrate of one fragment, bit/s: the `BANDWIDTH` of the rung. */
  peak: number;
  /** Bitrate of the whole file over its duration, bit/s. */
  average: number;
  seconds: number;
}

/** Largest header read: `moov` of a two-hour copy is well under this. */
const HEAD_BYTES = 8 * 1024 * 1024;

/** Largest `mfra` trailer accepted after the last fragment. */
const TRAILER_BYTES = 1024 * 1024;

interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

function boxes(buf: Buffer, limit: number) {
  const list: Box[] = [];
  let at = 0;
  while (at + 8 <= limit) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > limit) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    }
    if (size < header) throw new Error(`bad ${type} box`);
    list.push({ type, start: at, size, header });
    if (type === 'moof') break;
    at += size;
  }
  return list;
}

/**
 * Reads the index of the fragments of `buf` (the first bytes of the file) and checks it against
 * `fileBytes`: every byte after the header belongs to exactly one fragment.
 */
export function parseFragmentIndex(buf: Buffer, fileBytes: number): FragmentIndex {
  const list = boxes(buf, buf.length);
  const moov = list.find((b) => b.type === 'moov');
  const sidxBoxes = list.filter((b) => b.type === 'sidx');
  if (!moov || sidxBoxes.length === 0) throw new Error('no fragment index in the copy');
  // One sidx per track: the first (the video track, written first) indexes whole fragments.
  const sidx = sidxBoxes[0] as Box;
  let p = sidx.start + sidx.header;
  const version = buf.readUInt8(p);
  p += 4 + 4; // version, flags, reference_ID
  const timescale = buf.readUInt32BE(p);
  p += 4;
  let firstOffset: number;
  if (version === 0) {
    p += 4;
    firstOffset = buf.readUInt32BE(p);
    p += 4;
  } else {
    p += 8;
    firstOffset = Number(buf.readBigUInt64BE(p));
    p += 8;
  }
  p += 2;
  const count = buf.readUInt16BE(p);
  p += 2;
  if (!timescale || p + count * 12 > buf.length) throw new Error('fragment index cut short');
  let offset = sidx.start + sidx.size + firstOffset;
  // The global index sits after every per-track index: fragments start after the last one.
  const last = sidxBoxes.at(-1) as Box;
  offset = Math.max(offset, last.start + last.size);
  const fragments: FragmentIndex['fragments'] = [];
  let peak = 0;
  let seconds = 0;
  for (let i = 0; i < count; i++) {
    const ref = buf.readUInt32BE(p);
    const duration = buf.readUInt32BE(p + 4);
    p += 12;
    if (ref & 0x80000000) throw new Error('nested fragment index');
    const bytes = ref & 0x7fffffff;
    const length = duration / timescale;
    seconds += length;
    fragments.push({ offset, bytes, seconds: length });
    // A last sliver of a fragment says little about the rate: only whole seconds count.
    if (length >= 1) peak = Math.max(peak, (bytes * 8) / length);
    offset += bytes;
  }
  // What follows the last fragment is the `mfra` trailer, a few hundred bytes per hour.
  if (offset > fileBytes || fileBytes - offset > TRAILER_BYTES)
    throw new Error(`fragment index ends at ${offset}, file at ${fileBytes}`);
  return {
    initBytes: moov.start + moov.size,
    fragments,
    peak: Math.round(peak || (seconds > 0 ? (fileBytes * 8) / seconds : 0)),
    average: seconds > 0 ? Math.round((fileBytes * 8) / seconds) : 0,
    seconds,
  };
}

export async function readFragmentIndex(path: string): Promise<FragmentIndex> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    await file.read(buf, 0, buf.length, 0);
    return parseFragmentIndex(buf, size);
  } finally {
    await file.close();
  }
}

/** Byte-range HLS media playlist of one rendition, whose file is at `uri` (relative). */
export function mediaPlaylist(index: FragmentIndex, uri: string) {
  const target = Math.max(1, Math.ceil(Math.max(...index.fragments.map((f) => f.seconds))));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${index.initBytes}@0"`,
  ];
  for (const f of index.fragments)
    lines.push(`#EXTINF:${f.seconds.toFixed(3)},`, `#EXT-X-BYTERANGE:${f.bytes}@${f.offset}`, uri);
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}
