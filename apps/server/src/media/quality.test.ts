import { describe, expect, it } from 'vitest';
import { parseBitrate, rungRate } from './quality.ts';

describe('rungRate', () => {
  it('gives each rung its target, half again at peak and a two-second buffer', () => {
    expect(rungRate('balanced', 1080, 25)).toEqual({
      target: 6_000_000,
      peak: 9_000_000,
      buffer: 18_000_000,
    });
    expect(rungRate('light', 480, 24).target).toBe(900_000);
    expect(rungRate('high', 2160, 24).target).toBe(32_000_000);
  });

  it('adds 40 % above 30 frames per second', () => {
    expect(rungRate('balanced', 1080, 50).target).toBe(8_400_000);
    expect(rungRate('balanced', 1080, 29.97).target).toBe(6_000_000);
    expect(rungRate('balanced', 1080, null).target).toBe(6_000_000);
  });

  it('scales a size between rungs by its area, and caps past 2160', () => {
    // 900p takes 1080p's rate for (900/1080)² of the pixels.
    expect(rungRate('balanced', 900, 25).target).toBe(Math.round(6e6 * (900 / 1080) ** 2));
    expect(rungRate('balanced', 4320, 25).target).toBe(20_000_000);
  });

  it('keeps the peak and the target under VIDEO_PROXY_BITRATE', () => {
    const capped = rungRate('balanced', 1080, 25, 5_000_000);
    expect(capped.peak).toBe(5_000_000);
    expect(capped.target).toBe(Math.round(5e6 / 1.5));
    // A cap above the preset changes nothing.
    expect(rungRate('balanced', 480, 25, 5_000_000).peak).toBe(2_100_000);
  });
});

describe('parseBitrate', () => {
  it('reads ffmpeg rates', () => {
    expect(parseBitrate('5M')).toBe(5e6);
    expect(parseBitrate('2500k')).toBe(2.5e6);
    expect(parseBitrate('800000')).toBe(800000);
    expect(parseBitrate('fast')).toBeNull();
    expect(parseBitrate(null)).toBeNull();
  });
});
