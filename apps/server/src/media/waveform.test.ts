import { describe, expect, it } from 'vitest';
import { BlockPeaks, reducePeaks, WAVEFORM_PEAKS } from './waveform.ts';

/** Signed 16-bit little-endian PCM of `samples`. */
const pcm = (samples: number[]) => {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (const [i, s] of samples.entries()) view.setInt16(i * 2, s, true);
  return out;
};

describe('reducePeaks', () => {
  it('keeps the loudest block of each slice, the loudest of all at 100', () => {
    expect(reducePeaks([0, 10, 5, 20, 0, 40], 3)).toEqual([25, 50, 100]);
  });

  it('never makes more peaks than blocks, and none for empty input', () => {
    expect(reducePeaks([7, 7], 10)).toEqual([100, 100]);
    expect(reducePeaks([])).toEqual([]);
  });

  it('draws silence flat', () => {
    expect(reducePeaks(new Array(500).fill(0))).toEqual(new Array(WAVEFORM_PEAKS).fill(0));
  });
});

describe('BlockPeaks', () => {
  it('reads one loudest sample per 80, negative ones too, across split chunks', () => {
    const samples = [...new Array(80).fill(100), ...new Array(79).fill(0), -32768, 16384];
    const bytes = pcm(samples);
    const peaks = new BlockPeaks();
    // Cut in the middle of a sample.
    peaks.push(bytes.subarray(0, 101));
    peaks.push(bytes.subarray(101));
    peaks.flush();
    expect(peaks.blocks).toEqual([1, 255, 128]);
  });
});
