import type { Element } from '@inkadra/doc-schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Card } from './cards.tsx';

const state = vi.hoisted(() => ({
  editing: null as string | null,
  readOnly: false,
  kind: 'file',
  status: 'ready' as 'ready' | 'missing' | 'loading',
  boards: [
    { id: 'b1', title: 'Location Scout', kind: 'board', myRole: 'editor' },
    { id: 'b2', title: 'Storyboard 1', kind: 'storyboard', myRole: 'editor' },
  ],
  projectId: 'p1',
}));
vi.mock('./context.ts', async (original) => ({
  ...(await original<object>()),
  useBoard: () => ({ ...state, scale: 1, store: {}, setEditing: vi.fn() }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./assets.ts', () => ({
  useAsset: () =>
    state.status === 'loading'
      ? undefined
      : state.status === 'missing'
        ? 'missing'
        : {
            kind: state.kind,
            filename: 'schedule.pdf',
            size: 1024,
            variants: [],
            durationMs: null,
          },
  pickVariant: () => '',
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
