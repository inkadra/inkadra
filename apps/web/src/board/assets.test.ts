import type { Asset } from '@inkadra/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from '../lib/api.ts';
import {
  getCachedAsset,
  loadAsset,
  pickVariant,
  playbackUrl,
  resetAssetCache,
  setAssetLoader,
} from './assets.ts';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: {
    get: mockApi.get,
  },
}));

const sampleAsset: Asset = {
  id: 'asset-01',
  projectId: 'proj-01',
  kind: 'file',
  filename: 'presentation.pdf',
  mime: 'application/pdf',
  size: 2048,
  sha256: null,
  width: null,
  height: null,
  durationMs: null,
  videoCodec: null,
  audioCodec: null,
  frameRate: null,
  pageCount: null,
  proxy: null,
  waveformUrl: null,
  animated: false,
  track: null,
  status: 'ready',
  url: '/api/v1/assets/asset-01/file',
  variants: [],
  exif: null,
  palette: [],
  sourceUrl: null,
  createdAt: '2026-10-26T12:00:00.000Z',
};

describe('asset loader and network errors', () => {
  beforeEach(() => {
    resetAssetCache();
    setAssetLoader(null);
    mockApi.get.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('network error then success ends with the asset', async () => {
    // First poll fails due to a network drop (TypeError: Failed to fetch)
    mockApi.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await loadAsset(sampleAsset.id);

    // Cache should NOT be marked missing; it should remain unknown/undefined
    expect(getCachedAsset(sampleAsset.id)).toBeUndefined();

    // Second poll succeeds once network is back
    mockApi.get.mockResolvedValueOnce(sampleAsset);
    await loadAsset(sampleAsset.id);

    expect(getCachedAsset(sampleAsset.id)).toEqual(sampleAsset);
  });

  it('404 gives "missing"', async () => {
    // The server answers with an actual 404 Not Found
    mockApi.get.mockRejectedValueOnce(new RequestError(404, 'not_found', 'Asset not found'));
    await loadAsset(sampleAsset.id);

    expect(getCachedAsset(sampleAsset.id)).toBe('missing');
  });

  it('error keeps a previously known asset', async () => {
    const pendingAsset: Asset = { ...sampleAsset, status: 'pending' };

    // Initial poll succeeds with pending status
    mockApi.get.mockResolvedValueOnce(pendingAsset);
    await loadAsset(pendingAsset.id);
    expect(getCachedAsset(pendingAsset.id)).toEqual(pendingAsset);

    // Subsequent poll fails with a network error
    mockApi.get.mockRejectedValueOnce(new TypeError('Network offline'));
    await loadAsset(pendingAsset.id);

    // The asset in cache must NOT become 'missing'; it must keep the previous known value
    expect(getCachedAsset(pendingAsset.id)).toEqual(pendingAsset);

    // Even a 500 server error preserves the previous value
    mockApi.get.mockRejectedValueOnce(new RequestError(500, 'internal_error', 'Server error'));
    await loadAsset(pendingAsset.id);
    expect(getCachedAsset(pendingAsset.id)).toEqual(pendingAsset);
  });

  it('keeps the guest loader behaviour working', async () => {
    // Guest loader returns null for any asset not in its snapshot
    setAssetLoader(async () => null);
    await loadAsset('guest-unknown');

    expect(getCachedAsset('guest-unknown')).toBe('missing');

    resetAssetCache();
    expect(getCachedAsset('guest-unknown')).toBeUndefined();
  });
});

describe('playbackUrl', () => {
  const copy = {
    status: 'ready' as const,
    progress: 100,
    url: '/copy',
    mime: 'audio/mp4' as const,
    width: null,
    height: null,
    size: 10,
  };
  const voice: Asset = {
    ...sampleAsset,
    kind: 'audio',
    mime: 'audio/ogg',
    url: '/orig',
    proxy: copy,
  };

  it('plays the original audio where the browser reads it, else the AAC copy', () => {
    expect(playbackUrl(voice, () => true)).toBe('/orig');
    expect(playbackUrl(voice, () => false)).toBe('/copy');
    expect(playbackUrl({ ...voice, proxy: null }, () => false)).toBe('/orig');
  });

  it('always plays the copy of a video', () => {
    const video: Asset = {
      ...voice,
      kind: 'video',
      mime: 'video/quicktime',
      proxy: { ...copy, mime: 'video/mp4' },
    };
    expect(playbackUrl(video, () => true)).toBe('/copy');
  });
});

describe('pickVariant processing boundary', () => {
  it('withholds remote thumbnails until ready, even when variants are advertised', () => {
    for (const mime of [
      'image/x-nikon-nef',
      'image/vnd.adobe.photoshop',
      'application/pdf',
      'video/mp4',
      'image/jpeg',
    ]) {
      const asset = {
        ...sampleAsset,
        mime,
        variants: [{ size: '256' as const, width: 256, height: 170, url: '/thumb' }],
      };
      for (const status of ['pending', 'processing', 'failed'] as const)
        expect(pickVariant({ ...asset, status }, 200)).toBe('');
      expect(pickVariant({ ...asset, status: 'ready' }, 200)).toBe('/thumb');
    }
  });
});

describe('video audio safety', () => {
  it.each(['ac3', 'eac3', 'dts', 'flac', 'opus', 'aac'])(
    'never falls back to the H.264 MKV original with %s sound',
    (audioCodec) => {
      const video: Asset = {
        ...sampleAsset,
        kind: 'video',
        mime: 'video/x-matroska',
        videoCodec: 'h264',
        audioCodec,
        url: '/original.mkv',
      };
      for (const status of ['queued', 'processing', 'failed', 'skipped'] as const) {
        expect(
          playbackUrl({
            ...video,
            proxy: {
              status,
              progress: null,
              url: null,
              mime: 'video/mp4',
              width: null,
              height: null,
              size: null,
            },
          }),
        ).toBeUndefined();
      }
    },
  );
});

it('plays a video original the server needs no copy of', () => {
  expect(playbackUrl({ ...sampleAsset, kind: 'video', url: '/orig', proxy: null })).toBe('/orig');
});
