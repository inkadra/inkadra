import type { Element } from '@inkadra/doc-schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Card } from './cards.tsx';

const state = vi.hoisted(() => ({
  editing: null as string | null,
  readOnly: false,
  kind: 'file',
  status: 'ready' as 'ready' | 'missing' | 'loading',
  asset: {} as Record<string, unknown>,
  boards: [
    { id: 'b1', title: 'Location Scout', kind: 'board', myRole: 'editor' },
    { id: 'b2', title: 'Storyboard 1', kind: 'storyboard', myRole: 'editor' },
  ],
  projectId: 'p1',
}));
vi.mock('./context.ts', async (original) => ({
  ...(await original<object>()),
  useBoard: () => ({ ...state, scale: 1, store: { takeAdded: () => false }, setEditing: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
    i18n: { language: 'en' },
  }),
}));
vi.mock('./assets.ts', () => ({
  useAsset: () =>
    state.status === 'loading'
      ? undefined
      : state.status === 'missing'
        ? 'missing'
        : {
            id: 'asset-id',
            kind: state.kind,
            mime: 'application/pdf',
            filename: 'schedule.pdf',
            size: 1024,
            status: 'ready',
            url: '/api/v1/assets/asset-id/file',
            width: null,
            height: null,
            durationMs: null,
            videoCodec: null,
            audioCodec: null,
            frameRate: null,
            pageCount: null,
            proxy: null,
            exif: null,
            variants: [],
            ...state.asset,
          },
  pickVariant: (asset: { variants: Array<{ url: string }> }) => asset.variants.at(-1)?.url ?? '',
}));
vi.mock('./uploads.ts', () => ({ useUploadProgress: () => null, localPreview: () => null }));
vi.mock('./CardReview.tsx', () => ({ CardReview: () => null }));

const file = {
  id: 'file_caption_01',
  type: 'file',
  assetId: 'asset-id',
  x: 0,
  y: 0,
  w: 240,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
} as const;
const render = (element: Element) =>
  renderToStaticMarkup(<Card element={element} selected={false} />);

describe('file card captions', () => {
  it('shows a plain-text caption below regular, video, loading and missing file cards', () => {
    for (const kind of ['file', 'video']) {
      for (const status of ['ready', 'loading', 'missing'] as const) {
        Object.assign(state, { kind, status, editing: null, readOnly: false });
        vi.stubGlobal('window', { devicePixelRatio: 1 });
        const html = render({ ...file, caption: 'Observatory <schedule>' });
        expect(html).toContain('<div class="card__caption">Observatory &lt;schedule&gt;</div>');
      }
    }
    vi.unstubAllGlobals();
  });

  it('leaves old file cards without a caption unchanged', () => {
    Object.assign(state, { kind: 'file', status: 'ready', editing: null, readOnly: false });
    expect(render(file)).toContain('schedule.pdf');
    expect(render(file)).not.toContain('card__caption');
    expect(render({ ...file, caption: '' })).not.toContain('card__caption');
  });

  it('uses the same bounded caption editor for files and images', () => {
    Object.assign(state, { kind: 'file', status: 'ready', editing: file.id, readOnly: false });
    for (const type of ['file', 'image'] as const) {
      const html = render({ ...file, type, caption: 'Call sheet' });
      expect(html).toContain('<textarea');
      expect(html).toContain('maxLength="2000"');
      expect(html).toContain('aria-label="board.caption.label"');
      expect(html).toContain('Call sheet</textarea>');
    }
  });

  it('never offers caption editing on read-only or locked cards', () => {
    Object.assign(state, { kind: 'file', status: 'ready', editing: file.id, readOnly: true });
    expect(render({ ...file, caption: 'Call sheet' })).not.toContain('<textarea');
    state.readOnly = false;
    expect(render({ ...file, caption: 'Call sheet', locked: true })).not.toContain('<textarea');
    state.editing = null;
  });
});

describe('board cards', () => {
  const boardEl = {
    id: 'board_card_01',
    type: 'board' as const,
    boardId: 'b1',
    x: 0,
    y: 0,
    w: 240,
    h: 120,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
  };

  it('renders board title when not editing', () => {
    Object.assign(state, { editing: null, readOnly: false });
    const html = render(boardEl);
    expect(html).toContain('Location Scout');
    expect(html).toContain('board.types.board');
    expect(html).not.toContain('<input');
  });

  it('never offers renaming for read-only, locked or restricted child boards', () => {
    Object.assign(state, { editing: boardEl.id, readOnly: true });
    expect(render(boardEl)).not.toContain('<input');
    state.readOnly = false;
    expect(render({ ...boardEl, locked: true })).not.toContain('<input');
    for (const role of ['viewer', 'commenter']) {
      state.boards[0]!.myRole = role;
      expect(render(boardEl)).not.toContain('<input');
    }
    state.boards[0]!.myRole = 'editor';
    state.editing = null;
  });

  it('renders inline input when editing matches card id', () => {
    Object.assign(state, { editing: boardEl.id, readOnly: false });
    const html = render(boardEl);
    expect(html).toContain('<input');
    expect(html).toContain('class="card__inline-input card__title"');
    expect(html).toContain('value="Location Scout"');
    expect(html).toContain('aria-label="board.board.title"');
    state.editing = null;
  });
});

describe('scene headers', () => {
  it('keeps the slugline on its own line and the scene title under it', () => {
    Object.assign(state, { editing: null, readOnly: false });
    const html = render({
      ...file,
      id: 'scene_01',
      type: 'scene',
      number: '4',
      title: 'The platform',
      setting: 'ext',
      location: 'Central station',
      time: 'night',
    });
    expect(html).toContain('column__title--scene');
    expect(html).toMatch(
      /<span class="column__slug">film\.scene\.settings\.ext CENTRAL STATION – film\.scene\.times\.night<\/span><span class="column__name">The platform<\/span>/,
    );
  });
});

describe('video link cards', () => {
  it('fits content even for existing cards with an explicit oversized height and exposes a play button', () => {
    state.editing = null;
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const html = render({ ...file, type: 'link', url: 'https://youtu.be/yMnFHFf43Qg', h: 800 });
    expect(html).not.toContain('height:800');
    expect(html).toContain('data-play-link="file_caption_01"');
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="board.menu.playLink"');
    vi.unstubAllGlobals();
  });
});

describe('file card family', () => {
  const ready = (asset: Record<string, unknown>, kind = 'file') => {
    Object.assign(state, { kind, status: 'ready', editing: null, readOnly: false, asset });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const html = render(file);
    vi.unstubAllGlobals();
    state.asset = {};
    return html;
  };

  it('keeps the extension visible and shows a PDF with its first page and page count', () => {
    const html = ready({
      filename: 'athlete-guide-2026.pdf',
      size: 9 * 1024 * 1024,
      pageCount: 24,
      width: 1448,
      height: 2048,
      variants: [{ size: '512', width: 362, height: 512, url: '/v/512' }],
    });
    expect(html).toContain('<span class="fcard__stem">athlete-guide-2026</span>');
    expect(html).toContain('<span class="fcard__ext">.pdf</span>');
    expect(html).toContain('<span class="fbadge fbadge--doc">PDF</span>');
    expect(html).toContain('9 MB · board.file.pages:24');
    expect(html).toContain('class="fcard__page"');
    expect(html).toContain('src="/v/512"');
  });

  it('falls back to the icon tile when a file has no preview', () => {
    const html = ready({ filename: 'consegna-cliente.zip', mime: 'application/zip' });
    expect(html).toContain('fcard__tile fbadge--generic');
    expect(html).toContain('>ZIP</span>');
    for (const [name, family] of [
      ['trattamento-v3.docx', 'text'],
      ['budget.xlsx', 'doc'],
      ['poster.psd', 'design'],
      ['set.glb', '3d'],
      ['Recoleta-Bold.otf', 'font'],
    ] as const) {
      expect(ready({ filename: name, mime: 'application/octet-stream' })).toContain(
        `fbadge fbadge--${family}`,
      );
    }
  });

  it('shows a ProRes video with poster, play, duration, resolution and frame rate', () => {
    const html = ready(
      {
        kind: 'video',
        mime: 'video/quicktime',
        filename: 'intervista-A001.mov',
        size: 3.8 * 1024 ** 3,
        width: 3840,
        height: 2160,
        durationMs: 134_000,
        videoCodec: 'prores',
        frameRate: 25,
        proxy: { status: 'ready', progress: 100, url: '/p', mime: 'video/mp4' },
        variants: [{ size: '512', width: 512, height: 288, url: '/poster' }],
      },
      'video',
    );
    expect(html).toContain('<span class="fbadge fbadge--video">PRORES</span>');
    expect(html).toContain('3.8 GB · 4K · 25 fps');
    expect(html).toContain('<span class="card__play fcard__play" data-playable="file_caption_01"');
    expect(html).toContain('<span class="card__duration">2:14</span>');
    expect(html).toContain('src="/poster"');
  });

  it('says how far the playable copy is instead of offering to play it', () => {
    const html = ready(
      {
        kind: 'video',
        mime: 'application/mxf',
        filename: 'drone-B014.mxf',
        width: 6144,
        height: 3456,
        videoCodec: 'dnxhd',
        proxy: { status: 'processing', progress: 42, url: null, mime: 'video/mp4' },
      },
      'video',
    );
    expect(html).toContain('board.file.preparing');
    expect(html).toContain('width:42%');
    expect(html).toContain('42%</span>');
    expect(html).not.toContain('data-playable');
    expect(html).toContain('<span class="fbadge fbadge--video">MXF</span>');
    expect(html).toContain('DNxHD · 6K');
  });

  it('plays audio with the native control', () => {
    const html = ready(
      {
        kind: 'audio',
        mime: 'audio/mp4',
        filename: 'nota-vocale-regista.m4a',
        durationMs: 92_000,
      },
      'audio',
    );
    expect(html).toContain('<audio class="fcard__audio" src="/api/v1/assets/asset-id/file"');
    expect(html).toContain('controls');
    expect(html).toContain('<span class="fbadge fbadge--audio">M4A</span>');
    expect(html).toContain('1:32');
  });

  it('marks failed and processing files', () => {
    expect(ready({ status: 'failed', filename: 'broken.pdf' })).toContain('fcard fcard--failed');
    expect(ready({ status: 'failed', filename: 'broken.pdf' })).toContain('board.image.failed');
    const processing = ready({ status: 'processing', filename: 'slow.pdf' });
    expect(processing).toContain('fcard fcard--processing');
    expect(processing).toContain('board.image.processing');
    Object.assign(state, { status: 'missing' });
    expect(render(file)).toContain('fcard fcard--failed');
    expect(render(file)).toContain('board.file.missing');
  });

  it('gives camera RAW images a RAW badge with camera and exposure', () => {
    const exif = { Make: 'FUJIFILM', Model: 'X-T5', FNumber: 2, ExposureTime: 1 / 250 };
    const raw = {
      kind: 'image',
      mime: 'image/x-fuji-raf',
      filename: 'DSCF4417.RAF',
      size: 33 * 1024 * 1024,
      width: 6240,
      height: 4160,
      exif,
      variants: [{ size: '512', width: 512, height: 341, url: '/raw-preview' }],
    };
    const asFile = ready(raw, 'image');
    expect(asFile).toContain('<span class="fbadge fbadge--image">RAW</span>');
    expect(asFile).toContain('33 MB · X-T5 · f/2 · 1/250');
    expect(asFile).toContain('src="/raw-preview"');
    Object.assign(state, { kind: 'image', status: 'ready', asset: raw });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const asImage = render({ ...file, type: 'image' });
    vi.unstubAllGlobals();
    expect(asImage).toContain('<span class="fbadge fbadge--image">RAW</span>');
    expect(asImage).toContain('X-T5 · f/2 · 1/250');
    // Plain photos keep their caption-only look.
    Object.assign(state, { asset: { ...raw, mime: 'image/jpeg', filename: 'bosco.jpg' } });
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    expect(render({ ...file, type: 'image' })).not.toContain('fbadge');
    vi.unstubAllGlobals();
    state.asset = {};
  });
});
