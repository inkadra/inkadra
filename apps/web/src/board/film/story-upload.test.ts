import { addElement, createBoardDoc, Element, readElement, roots } from '@inkadra/doc-schema';
import { expect, it, vi } from 'vitest';
import type { BoardStore } from '../store.ts';
import type { StartUpload } from '../uploads.ts';
import { uploadToStoryCard } from './story-upload.ts';

const started: StartUpload[] = [];
vi.mock('../uploads.ts', () => ({
  startUpload: (input: StartUpload) => {
    started.push(input);
    return `u${started.length}`;
  },
  cancelUpload: () => {},
  useUploads: () => [],
}));

const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
const file = new File(['x'], 'photo.png', { type: 'image/png' });

function setup(fields: Record<string, unknown>) {
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  addElement(doc, Element.parse({ ...base, id: 'marta_____', type: 'character', ...fields }));
  const read = () => readElement(roots(doc).elements.get('marta_____')!) as Record<string, unknown>;
  const store = {
    doc,
    undo: { stopCapturing: () => {} },
    getSnapshot: () => ({ byId: new Map([['marta_____', read()]]) }),
  } as unknown as BoardStore;
  return { store, read };
}

const common = { cardId: 'marta_____', file, projectId: 'p', boardId: 'b' };

it('keeps the photo until every byte has arrived, and when the upload fails', () => {
  const { store, read } = setup({ name: 'Marta', assetId: 'old' });
  uploadToStoryCard({ ...common, store, target: 'photo' });
  const upload = started.at(-1)!;
  upload.onAsset('new');
  expect(read().assetId).toBe('old');
  upload.onFailed?.('new');
  expect(read().assetId).toBe('old');
  upload.onComplete?.('new');
  expect(read().assetId).toBe('new');
});

it('adds a reference to the card as it is when the upload ends, and only once', () => {
  const { store, read } = setup({ name: 'Marta', references: ['a'] });
  uploadToStoryCard({ ...common, store, target: 'reference' });
  const upload = started.at(-1)!;
  upload.onComplete?.('b');
  upload.onComplete?.('b');
  expect(read().references).toEqual(['a', 'b']);
});

it('leaves a card locked meanwhile as it is', () => {
  const { store, read } = setup({ name: 'Marta', assetId: 'old', locked: true });
  uploadToStoryCard({ ...common, store, target: 'photo' });
  started.at(-1)!.onComplete?.('new');
  expect(read().assetId).toBe('old');
});
