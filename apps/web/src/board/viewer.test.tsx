// @vitest-environment happy-dom
import type { Element } from '@inkadra/doc-schema';
import type { Asset, GuestAsset } from '@inkadra/shared';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GuestActions, GuestActionsContext } from '../guest/actions.ts';
import { GuestViewer } from '../guest/GuestViewer.tsx';
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

describe('mounted viewer error events', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (node: ReactNode) => act(async () => root.render(node));
  const member = (element = fileElement) => (
    <MediaViewer
      store={{} as import('./store.ts').BoardStore}
      element={element}
      projectId="proj-01"
      userId="user-01"
      readOnly={true}
      onClose={vi.fn()}
    />
  );
  const guestAsset: GuestAsset = {
    id: videoAsset.id,
    kind: 'video',
    mime: videoAsset.mime,
    filename: videoAsset.filename,
    size: videoAsset.size,
    width: videoAsset.width,
    height: videoAsset.height,
    durationMs: videoAsset.durationMs,
    variants: videoAsset.variants,
    downloadUrl: '/api/v1/guest/links/link/assets/video-prores/file',
  };
  const guest = (download: boolean, asset = guestAsset) => (
    <GuestActionsContext.Provider
      value={
        {
          linkId: 'link',
          boardId: 'board',
          guestName: null,
          version: '1',
          rights: { download, pick: false, comments: false, review: false },
          assets: new Map([[asset.id, asset]]),
          reviews: new Map(),
          picks: new Map(),
          counts: new Map(),
          pick: vi.fn(async () => {}),
          review: vi.fn(async () => false),
          withName: vi.fn(),
          refresh: vi.fn(),
          fail: vi.fn(() => null),
          select: vi.fn(),
          view: vi.fn(),
          notify: vi.fn(),
          notice: null,
        } satisfies GuestActions
      }
    >
      <GuestViewer element={fileElement} onClose={vi.fn()} />
    </GuestActionsContext.Provider>
  );
  const fail = async (code: number) => {
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    Object.defineProperty(video, 'error', { configurable: true, value: { code } });
    await act(async () => {
      video?.dispatchEvent(new Event('error'));
    });
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockState.asset = videoAsset;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([3, 4])(
    'shows the member fallback on media error %i and resets for another asset',
    async (code) => {
      await render(member());
      await fail(code);
      expect(container.querySelector('.viewer__unplayable')?.textContent).toContain(
        'Formato non riproducibile',
      );
      expect(container.querySelector('.viewer__unplayable a')?.getAttribute('href')).toBe(
        videoAsset.url,
      );
      expect(container.querySelector('video')?.style.display).toBe('none');
      mockState.asset = { ...videoAsset, id: 'other', url: '/other-video' };
      await render(member({ ...fileElement, assetId: 'other' }));
      expect(container.querySelector('.viewer__unplayable')).toBeNull();
      expect(container.querySelector('video')?.style.display).toBe('');
    },
  );

  it.each([1, 2])('does not mislabel an abort/network error %i as a codec error', async (code) => {
    await render(member());
    await fail(code);
    expect(container.querySelector('.viewer__unplayable')).toBeNull();
    expect(container.querySelector('video')?.style.display).toBe('');
  });

  it('offers only the guest download URL after a codec error, and removes it when rights change', async () => {
    await render(guest(true));
    await fail(4);
    expect(container.querySelector('.guest-viewer__unplayable a')?.getAttribute('href')).toBe(
      guestAsset.downloadUrl,
    );
    expect(container.innerHTML).not.toContain(videoAsset.url);
    await render(guest(false));
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.innerHTML).not.toContain(guestAsset.downloadUrl);
    expect(container.querySelector('video')).toBeNull();
  });

  it('never embeds an original URL for a restricted guest, even with stale asset metadata', async () => {
    await render(guest(false));
    expect(container.querySelector('video')).toBeNull();
    expect(container.innerHTML).not.toContain(guestAsset.downloadUrl);
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('.guest-viewer__stage img')).not.toBeNull();
  });

  it('shows only the poster for the restricted server payload', async () => {
    await render(guest(false, { ...guestAsset, downloadUrl: null }));
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('.guest-viewer__stage img')).not.toBeNull();
  });

  it('detects playback stall when a video cannot decode frames after play', async () => {
    vi.useFakeTimers();
    try {
      await render(member());
      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      Object.defineProperty(video, 'paused', { configurable: true, value: false });
      Object.defineProperty(video, 'currentTime', { configurable: true, value: 0 });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 0 });

      await act(async () => {
        video?.dispatchEvent(new Event('waiting'));
        vi.advanceTimersByTime(2100);
      });

      expect(container.querySelector('.viewer__unplayable')?.textContent).toContain(
        'Formato non riproducibile',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
