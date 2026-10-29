// @vitest-environment happy-dom
import type { Element } from '@inkadra/doc-schema';
import type { Asset, GuestAsset } from '@inkadra/shared';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GuestActions, GuestActionsContext } from '../guest/actions.ts';
import { GuestViewer } from '../guest/GuestViewer.tsx';
import { resetReviews, setReviews } from './review-store.ts';
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
  animated: false,
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

  it('renders a privacy-friendly YouTube embed iframe for youtube link elements', () => {
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

    const youtubeElement: Extract<Element, { type: 'link' }> = {
      id: 'link-yt',
      type: 'link',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      description: 'Official music video',
      x: 0,
      y: 0,
      w: 300,
      z: 'a0',
      parent: null,
      createdBy: null,
      tags: ['music'],
      createdAt: 0,
    };

    const html = renderToStaticMarkup(
      <MediaViewer
        store={fakeStore}
        element={youtubeElement}
        projectId="proj-01"
        userId="user-01"
        readOnly={false}
        gallery={{
          index: 3,
          total: 5,
          onPrevious: vi.fn(),
          onNext: vi.fn(),
          onCompare: vi.fn(),
          usedIn: [],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('<iframe');
    expect(html).not.toContain('web-share');
    expect(html).toContain('viewer__media-wrap--embed');
    expect(html).toContain('viewer__action-icon');
    expect(html).toContain('viewer__action-label');
    expect(html).toContain('aria-label="Chiudi"');
    expect(html).toContain('aria-label="moodboard.compare"');
    expect(html).toContain('aria-label="viewer.zoom100"');
    expect(html).toContain(
      'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;rel=0"',
    );
    expect(html).toContain('Never Gonna Give You Up');
    expect(html).toContain('Official music video');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');

    vi.unstubAllGlobals();
  });
});

describe('MediaViewer pictures', () => {
  const gif: Asset = {
    ...videoAsset,
    id: 'gif-01',
    kind: 'image',
    mime: 'image/gif',
    filename: 'loop.gif',
    durationMs: null,
    animated: true,
    url: '/api/v1/assets/gif-01/file',
    variants: [
      { size: '256', width: 256, height: 160, url: '/api/v1/assets/gif-01/variants/256' },
      { size: '512', width: 512, height: 320, url: '/api/v1/assets/gif-01/variants/512' },
    ],
  };
  const picture: Extract<Element, { type: 'image' }> = {
    ...fileElement,
    type: 'image',
    assetId: 'gif-01',
    caption: 'Il gatto',
  };
  const store = {
    undo: { stopCapturing: vi.fn() },
    doc: { transact: vi.fn() },
  } as unknown as import('./store.ts').BoardStore;

  it('shows the poster of a GIF, then its moving variant once loaded', async () => {
    mockState.asset = gif;
    const probes: FakeImage[] = [];
    /** The off-screen picture MovingPicture loads the moving variant with. */
    class FakeImage {
      onload: (() => void) | null = null;
      src = '';
      constructor() {
        probes.push(this);
      }
    }
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('Image', FakeImage);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const media = () => container.querySelector('.viewer__media');

    try {
      await act(async () => {
        root.render(
          <MediaViewer
            store={store}
            element={picture}
            projectId="proj-01"
            userId="user-01"
            readOnly={false}
            onClose={vi.fn()}
          />,
        );
      });
      expect(media()?.getAttribute('src')).toBe('https://example.com/poster.jpg');
      expect(probes.map((p) => p.src)).toEqual(['/api/v1/assets/gif-01/variants/512?animated=1']);

      await act(async () => probes[0]?.onload?.());
      expect(media()?.getAttribute('src')).toBe('/api/v1/assets/gif-01/variants/512?animated=1');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
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
    animated: videoAsset.animated,
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

describe('MediaViewer gallery enhancements', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (node: ReactNode) => act(async () => root.render(node));

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockState.asset = {
      id: 'img-1',
      kind: 'image',
      filename: 'photo.jpg',
      url: '/photo.jpg',
      width: 1920,
      height: 1080,
      palette: ['#ff0000', '#00ff00'],
      variants: [],
    } as unknown as import('@inkadra/shared').Asset;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders gallery controls, navigates with arrows, and renders thumbnail strip', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onSelect = vi.fn();

    await render(
      <MediaViewer
        store={{} as import('./store.ts').BoardStore}
        element={
          {
            id: 'el-1',
            type: 'image',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            assetId: 'img-1',
          } as unknown as Extract<import('@inkadra/doc-schema').Element, { type: 'image' }>
        }
        projectId="proj-01"
        userId="user-01"
        readOnly={false}
        onClose={vi.fn()}
        gallery={{
          index: 1,
          total: 3,
          onPrevious: onPrev,
          onNext: onNext,
          onSelect,
          items: [
            { id: 'el-0', assetId: 'img-0', filename: 'one.jpg' },
            { id: 'el-1', assetId: 'img-1', filename: 'two.jpg' },
            { id: 'el-2', assetId: 'img-2', filename: 'three.jpg' },
          ],
          usedIn: ['Storyboard 4C'],
        }}
      />,
    );

    expect(container.querySelector('.viewer__stage-counter')?.textContent).toBe('2 / 3');
    expect(container.querySelectorAll('.viewer__thumb')).toHaveLength(3);
    expect(container.querySelector('.viewer__used-chip')?.textContent).toBe('Storyboard 4C');

    const nextBtn = container.querySelector<HTMLButtonElement>('.viewer__stage-nav--next');
    expect(nextBtn).not.toBeNull();
    await act(async () => nextBtn?.click());
    expect(onNext).toHaveBeenCalledTimes(1);

    const firstThumb = container.querySelectorAll<HTMLButtonElement>('.viewer__thumb')[0];
    await act(async () => firstThumb?.click());
    expect(onSelect).toHaveBeenCalledWith(0);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('toggles zoom on spacebar and supports copy all palette', async () => {
    let clipboard = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          clipboard = text;
        }),
      },
    });

    await render(
      <MediaViewer
        store={{} as import('./store.ts').BoardStore}
        element={
          {
            id: 'el-1',
            type: 'image',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            assetId: 'img-1',
          } as unknown as Extract<import('@inkadra/doc-schema').Element, { type: 'image' }>
        }
        projectId="proj-01"
        userId="user-01"
        readOnly={false}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelector('.viewer__media--contain')).not.toBeNull();
    expect(container.querySelector('.viewer__media--zoom100')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    expect(container.querySelector('.viewer__media--zoom100')).not.toBeNull();

    const copyAll = container.querySelector<HTMLButtonElement>('.viewer__copy-all-btn');
    expect(copyAll).not.toBeNull();
    await act(async () => copyAll?.click());
    expect(clipboard).toBe('#ff0000 #00ff00');
  });
});

describe('MediaViewer keyboard, focus and comments', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (node: ReactNode) => act(async () => root.render(node));
  const element = {
    id: 'el-1',
    type: 'image',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    assetId: 'img-1',
  } as unknown as Extract<import('@inkadra/doc-schema').Element, { type: 'image' }>;
  const viewer = (props: Partial<React.ComponentProps<typeof MediaViewer>> = {}) => (
    <MediaViewer
      store={{} as import('./store.ts').BoardStore}
      element={element}
      projectId="proj-01"
      userId="user-01"
      readOnly={false}
      onClose={vi.fn()}
      {...props}
    />
  );
  const space = (target: EventTarget) =>
    act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
    });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockState.asset = {
      id: 'img-1',
      kind: 'image',
      filename: 'photo.jpg',
      url: '/photo.jpg',
      palette: [],
      variants: [],
    } as unknown as Asset;
    resetReviews();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetReviews();
  });

  it('leaves Space to a focused button and does not zoom', async () => {
    await render(viewer());
    const button = container.querySelector<HTMLButtonElement>(
      '.viewer__stage-nav, .viewer__copy-all-btn, .viewer__stage-btn',
    );
    expect(button).not.toBeNull();
    button?.focus();
    let prevented = false;
    window.addEventListener('keydown', (e) => (prevented = e.defaultPrevented), { once: true });
    await space(button as HTMLElement);
    expect(prevented).toBe(false);
    expect(container.querySelector('.viewer__media--zoom100')).toBeNull();
  });

  it('leaves Space to the video controls', async () => {
    mockState.asset = { ...videoAsset } as Asset;
    await render(viewer());
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    await space(video);
    expect(container.querySelector('.viewer__media--zoom100')).toBeNull();
  });

  it('zooms with Space from the stage', async () => {
    await render(viewer());
    await space(container.querySelector('.viewer__stage') as HTMLElement);
    expect(container.querySelector('.viewer__media--zoom100')).not.toBeNull();
  });

  it('keeps Tab inside the dialog for a single image and restores focus on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    await render(viewer());
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
    focusable.at(-1)?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      document.activeElement?.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
    const field = document.createElement('textarea');
    dialog.append(field);
    field.focus();
    const fieldTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(fieldTab));
    expect(fieldTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
    await act(async () => root.render(<div />));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  describe('comments preview', () => {
    const thread = (id: string, resolvedAt: string | null) =>
      ({
        id,
        elementId: 'el-1',
        author: { kind: 'guest', name: 'Anna' },
        body: `body ${id}`,
        mentions: [],
        resolvedAt,
      }) as unknown as import('@inkadra/shared').CommentThread;

    it('shows loading, then only the open threads', async () => {
      resetReviews({ boardId: 'b1', status: 'loading', role: 'editor' });
      await render(viewer());
      const section = () => container.querySelector('.viewer__comments-section');
      expect(section()?.textContent).toContain('comments.loading');
      await act(async () =>
        setReviews({
          status: 'ready',
          threads: [thread('t1', null), thread('t2', '2026-01-01T00:00:00Z')],
        }),
      );
      expect(section()?.querySelectorAll('.viewer__comment-card')).toHaveLength(1);
      expect(section()?.textContent).toContain('body t1');
      expect(section()?.textContent).not.toContain('body t2');
    });

    it('offers the panel only to people who can comment', async () => {
      resetReviews({ boardId: 'b1', status: 'ready', role: 'viewer' });
      await render(viewer());
      expect(container.querySelector('.viewer__open-comments-btn')).toBeNull();
      await act(async () => setReviews({ role: 'commenter' }));
      expect(container.querySelector('.viewer__open-comments-btn')).not.toBeNull();
    });
  });
});

describe('viewer translations', () => {
  it('has every key the viewer uses in both languages', async () => {
    const [en, it_] = await Promise.all([import('../i18n/en.json'), import('../i18n/it.json')]);
    const keys = [
      'viewer.copyAll',
      'viewer.copiedAll',
      'viewer.zoomFit',
      'viewer.zoom100',
      'viewer.zoomHelp',
      'viewer.hints.nav',
      'viewer.hints.zoom',
      'viewer.keys.esc',
      'viewer.keys.space',
      'viewer.thumbnails',
      'viewer.item',
      'comments.title',
      'comments.open',
      'comments.loading',
      'comments.loadError',
      'comments.emptyOpen',
      'comments.deletedAuthor',
    ];
    const get = (o: unknown, k: string) =>
      k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);
    for (const k of keys) {
      expect(typeof get(en, k), k).toBe('string');
      expect(typeof get(it_, k), k).toBe('string');
    }
  });
});
