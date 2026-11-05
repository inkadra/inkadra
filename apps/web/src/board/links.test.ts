import { updateElement } from '@inkadra/canvas-core';
import { beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { fillLinkPreview, normalizeNoteLink } from './links.ts';

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
  expect(await fillLinkPreview(doc, 'card', 'project', 'board', 'https://example.com')).toBe(false);
  expect(updateElement).not.toHaveBeenCalled();
  doc.destroy();
});

it('omits empty fields so a successful refresh preserves good metadata', async () => {
  vi.mocked(api.post).mockResolvedValue({ title: '  ', description: null, imageAssetId: null });
  const doc = new Y.Doc();
  expect(await fillLinkPreview(doc, 'card', 'project', 'board', 'https://example.com')).toBe(true);
  expect(updateElement).toHaveBeenCalledWith(doc, 'card', {}, expect.anything());
  doc.destroy();
});

it('normalizes note links, prepends https when missing, and rejects unsafe schemes', () => {
  expect(normalizeNoteLink('example.com')).toBe('https://example.com');
  expect(normalizeNoteLink('example.com/path?foo=bar')).toBe('https://example.com/path?foo=bar');
  expect(normalizeNoteLink('https://example.com')).toBe('https://example.com');
  expect(normalizeNoteLink('http://example.com/page')).toBe('http://example.com/page');
  expect(normalizeNoteLink('mailto:team@example.com')).toBe('mailto:team@example.com');

  // Boundary validation: reject dangerous schemes and invalid strings
  expect(normalizeNoteLink('javascript:alert(1)')).toBeNull();
  expect(normalizeNoteLink('data:text/html,bad')).toBeNull();
  expect(normalizeNoteLink('file:///etc/passwd')).toBeNull();
  expect(normalizeNoteLink('vbscript:msgbox(1)')).toBeNull();
  expect(normalizeNoteLink('https://')).toBeNull();
  expect(normalizeNoteLink('')).toBeNull();
  expect(normalizeNoteLink('   ')).toBeNull();
});

