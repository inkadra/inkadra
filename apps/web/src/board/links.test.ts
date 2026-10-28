import { updateElement } from '@inkadra/canvas-core';
import { beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { fillLinkPreview } from './links.ts';

vi.mock('../lib/api.ts', () => ({ api: { post: vi.fn() } }));
vi.mock('@inkadra/canvas-core', () => ({ updateElement: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('refreshes a bare card with server metadata', async () => {
  vi.mocked(api.post).mockResolvedValue({
    title: 'Film',
    description: 'Director',
    imageAssetId: 'image',
  });
  const doc = new Y.Doc();
  await fillLinkPreview(doc, 'card', 'project', 'board', 'https://youtu.be/yMnFHFf43Qg');
  expect(api.post).toHaveBeenCalledWith('/link-previews', {
    projectId: 'project',
    boardId: 'board',
    url: 'https://youtu.be/yMnFHFf43Qg',
  });
  expect(updateElement).toHaveBeenCalledWith(
    doc,
    'card',
    { title: 'Film', description: 'Director', imageAssetId: 'image' },
    expect.anything(),
  );
  doc.destroy();
});
it('preserves existing content when refreshing fails', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('rate limited'));
  const doc = new Y.Doc();
  await fillLinkPreview(doc, 'card', 'project', 'board', 'https://example.com');
  expect(updateElement).not.toHaveBeenCalled();
  doc.destroy();
});
