import { describe, expect, it } from 'vitest';
import {
  codecName,
  exposureParts,
  extensionOf,
  fileBadge,
  fileFamily,
  formatBytes,
  fpsLabel,
  resolutionLabel,
  splitName,
} from './file-kinds.ts';

const asset = (filename: string, kind = 'file', mime = 'application/octet-stream') =>
  ({ filename, kind, mime, videoCodec: null }) as Parameters<typeof fileBadge>[0];

describe('file kinds', () => {
  it('splits the extension off for the middle ellipsis', () => {
    expect(splitName('intervista-A001.mov')).toEqual({ stem: 'intervista-A001', ext: '.mov' });
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' });
    expect(splitName('.env')).toEqual({ stem: '.env', ext: '' });
    expect(splitName('archive.verylongext')).toEqual({ stem: 'archive.verylongext', ext: '' });
    expect(extensionOf('a.B.PDF')).toBe('pdf');
  });

  it('puts each type in its family', () => {
    expect(fileFamily(asset('x.pdf', 'file', 'application/pdf'))).toBe('doc');
    expect(fileFamily(asset('x.mov', 'video'))).toBe('video');
    expect(fileFamily(asset('x.m4a', 'audio'))).toBe('audio');
    expect(fileFamily(asset('x.raf', 'file', 'image/x-fuji-raf'))).toBe('image');
    expect(fileFamily(asset('x.psd'))).toBe('design');
    expect(fileFamily(asset('x.gpx'))).toBe('map');
    expect(fileFamily(asset('x.glb'))).toBe('3d');
    expect(fileFamily(asset('x.woff2'))).toBe('font');
    expect(fileFamily(asset('x.zip'))).toBe('generic');
    expect(fileFamily(asset('x.unknown'))).toBe('generic');
    expect(fileFamily(asset('noext', 'file', 'audio/x-whatever'))).toBe('audio');
  });

  it('labels badges by extension, RAW and ProRes', () => {
    expect(fileBadge(asset('DSCF4417.RAF', 'image', 'image/x-fuji-raf'))).toBe('RAW');
    expect(fileBadge({ ...asset('a.mov', 'video'), videoCodec: 'prores' })).toBe('PRORES');
    expect(fileBadge({ ...asset('a.mxf', 'video'), videoCodec: 'dnxhd' })).toBe('MXF');
    expect(fileBadge(asset('poster.psd'))).toBe('PSD');
    expect(fileBadge(asset('scan', 'file', 'application/pdf'))).toBe('PDF');
  });

  it('formats sizes, resolutions, frame rates and codecs', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4.2 * 1024 * 1024, 'it')).toBe('4,2 MB');
    expect(formatBytes(148 * 1024 * 1024, 'en')).toBe('148 MB');
    expect(resolutionLabel(3840, 2160)).toBe('4K');
    expect(resolutionLabel(6144, 3456)).toBe('6K');
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1080, 1920)).toBe('1080p');
    expect(resolutionLabel(null, 1080)).toBe('');
    expect(fpsLabel(25, 'en')).toBe('25 fps');
    expect(fpsLabel(24000 / 1001, 'en')).toBe('23.98 fps');
    expect(fpsLabel(null)).toBe('');
    expect(codecName('h264')).toBe('H.264');
    expect(codecName('xyz')).toBe('XYZ');
  });

  it('reads camera and exposure from EXIF', () => {
    expect(
      exposureParts({ Make: 'FUJIFILM', Model: 'X-T5', FNumber: 2, ExposureTime: 0.004 }),
    ).toEqual(['X-T5', 'f/2', '1/250']);
    expect(exposureParts({ Make: 'Canon', Model: 'Canon EOS R5', ExposureTime: 2 })).toEqual([
      'EOS R5',
      '2 s',
    ]);
    expect(exposureParts(null)).toEqual([]);
  });
});
