import { describe, expect, it } from 'vitest';
import { ffmpegError, keepTail } from './tools.ts';

describe('ffmpegError', () => {
  it('drops the libva banner and keeps the end, where ffmpeg writes the error', () => {
    const banner = 'libva info: VA-API version 1.22.0\nlibva info: va_openDriver() returns 0\n';
    const stderr = `${banner.repeat(20)}[hevc_qsv] Error during decoding\nConversion failed!\n`;
    expect(ffmpegError(stderr)).toBe('[hevc_qsv] Error during decoding\nConversion failed!');
    expect(ffmpegError(`x${'y'.repeat(600)}`, 10)).toBe(`…${'y'.repeat(10)}`);
  });

  it('keeps the last part of a long output', () => {
    expect(keepTail('abc', 'def', 4)).toBe('cdef');
  });
});
