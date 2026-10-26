import type { Element } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { isUnplayableVideoError, MediaViewer, VideoUnplayable } from './viewer.tsx';

const mockState = vi.hoisted(() => ({
  asset: null as Asset | 'missing' | null,
}));

vi.mock('./assets.ts', () => ({
  useAsset: () => mockState.asset,
  pickVariant: () => 'https://example.com/poster.jpg',
}));

vi.mock('./tags.tsx', () => ({
  TagEditor: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const messages: Record<string, string> = {
        'viewer.title': 'Media',
        'viewer.unplayable': 'Formato non riproducibile nel browser',
        'viewer.download': 'Scarica l’originale',
        'viewer.close': 'Chiudi',
      };
      return messages[key] ?? key;
    },
    i18n: { language: 'it' },
  }),
}));

const videoAsset: Asset = {
  id: 'video-prores',
  projectId: 'proj-01',
  kind: 'video',
  filename: 'take_01_prores422hq.mov',
  mime: 'video/quicktime',
  size: 2600000000,
  sha256: null,
  width: 3840,
  height: 2160,
  durationMs: 45000,
  status: 'ready',
  url: '/api/v1/assets/video-prores/file',
  variants: [
    {
      size: '1024',
      width: 1920,
      height: 1080,
      url: 'https://example.com/poster.jpg',
    },
  ],
  exif: null,
  palette: [],
  sourceUrl: null,
  createdAt: '2026-10-26T12:00:00.000Z',
};

const fileElement: Extract<Element, { type: 'file' }> = {
  id: 'file-el-01',
  type: 'file',
  assetId: 'video-prores',
  x: 0,
  y: 0,
  w: 320,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
};

describe('unplayable video error detection', () => {
  it('recognizes SRC_NOT_SUPPORTED and DECODE errors as unplayable', () => {
    // MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED = 4
    expect(isUnplayableVideoError(4)).toBe(true);
    // MediaError.MEDIA_ERR_DECODE = 3
    expect(isUnplayableVideoError(3)).toBe(true);
    // Missing code or null code (unspecified playback error)
    expect(isUnplayableVideoError(null)).toBe(true);
    expect(isUnplayableVideoError(undefined)).toBe(true);
    expect(isUnplayableVideoError(0)).toBe(true);

    // Network errors or user aborted playback are not codec errors
    expect(isUnplayableVideoError(1)).toBe(false); // MEDIA_ERR_ABORTED
    expect(isUnplayableVideoError(2)).toBe(false); // MEDIA_ERR_NETWORK
  });
});

describe('VideoUnplayable overlay', () => {
  it('renders the unplayable message and download action over the poster', () => {
    const html = renderToStaticMarkup(
      <VideoUnplayable
        poster="https://example.com/poster.jpg"
        filename="take_01_prores422hq.mov"
        downloadUrl="/api/v1/assets/video-prores/file"
        downloadLabel="Scarica l’originale"
        message="Formato non riproducibile nel browser"
      />,
    );

    expect(html).toContain('Formato non riproducibile nel browser');
    expect(html).toContain('Scarica l’originale');
    expect(html).toContain('href="/api/v1/assets/video-prores/file"');
    expect(html).toContain('download="take_01_prores422hq.mov"');
    expect(html).toContain('src="https://example.com/poster.jpg"');
    expect(html).toContain('viewer__unplayable-scrim');
  });

  it('omits the download action when downloadUrl is undefined (e.g. restricted guest link)', () => {
    const html = renderToStaticMarkup(
      <VideoUnplayable
        poster="https://example.com/poster.jpg"
        filename="take_01_prores422hq.mov"
        downloadUrl={undefined}
        downloadLabel="Scarica l’originale"
        message="Formato non riproducibile nel browser"
      />,
    );

    expect(html).toContain('Formato non riproducibile nel browser');
    expect(html).not.toContain('Scarica l’originale');
    expect(html).not.toContain('<a');
    expect(html).toContain('src="https://example.com/poster.jpg"');
  });
});

describe('MediaViewer video playback', () => {
  it('renders a video element with controls and poster initially', () => {
    mockState.asset = videoAsset;
    vi.stubGlobal('window', {
      innerWidth: 1920,
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const fakeStore = {
      undo: { stopCapturing: vi.fn() },
      doc: { transact: vi.fn() },
    } as unknown as import('./store.ts').BoardStore;

    const html = renderToStaticMarkup(
      <MediaViewer
        store={fakeStore}
        element={fileElement}
        projectId="proj-01"
        userId="user-01"
        readOnly={false}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('<video');
    expect(html).toContain('src="/api/v1/assets/video-prores/file"');
    expect(html).toContain('controls=""');
    expect(html).toContain('poster="https://example.com/poster.jpg"');

    vi.unstubAllGlobals();
  });
});
