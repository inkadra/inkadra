import { addElement, createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { remapDoc, remapMentions } from './remap.ts';

const oldBoard = '11111111-1111-4111-8111-111111111111';
const newBoard = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
const newChild = '44444444-4444-4444-8444-444444444444';
const file = '55555555-5555-4555-8555-555555555555';
const newFile = '66666666-6666-4666-8666-666666666666';
const elsewhere = '77777777-7777-4777-8777-777777777777';
const author = '88888888-8888-4888-8888-888888888888';
const importer = '99999999-9999-4999-8999-999999999999';
const base = { x: 0, y: 0, w: 200, z: 'a0', parent: null, createdAt: 1, createdBy: author };

describe('remapDoc', () => {
  it('drops malformed provenance and sources of missing frame pictures', () => {
    const doc = createBoardDoc(oldBoard);
    const malformed = [
      null,
      'source',
      {},
      { kind: 'uploaded-video', assetId: file, timeSeconds: -1 },
      { kind: 'link-thumbnail', url: 'javascript:alert(1)' },
    ];
    malformed.forEach((source, index) => {
      const el = addElement(doc, {
        ...base,
        id: `bad-source-${index}`,
        type: 'image',
        assetId: file,
      });
      el.set('source', source);
    });
    addElement(doc, {
      ...base,
      id: 'missing-picture',
      type: 'frame',
      assetId: elsewhere,
      source: { kind: 'link-thumbnail', url: 'https://vimeo.com/123' },
    });
    remapDoc(doc, newBoard, {
      boards: new Map(),
      assets: new Map([[file, newFile]]),
      person: () => importer,
    });
    for (const el of roots(doc).elements.values()) expect(el.has('source')).toBe(false);
  });

  it('remaps character and location pictures and drops the ones not imported', () => {
    const doc = createBoardDoc(oldBoard);
    addElement(doc, {
      ...base,
      id: 'character-ok',
      type: 'character',
      name: 'Marta',
      assetId: file,
    });
    addElement(doc, {
      ...base,
      id: 'location-missing',
      type: 'location',
      name: 'Stazione Centrale',
      assetId: elsewhere,
    });
    remapDoc(doc, newBoard, {
      boards: new Map(),
      assets: new Map([[file, newFile]]),
      person: () => importer,
    });
    const { elements } = roots(doc);
    expect(elements.get('character-ok')?.get('assetId')).toBe(newFile);
    expect(elements.get('location-missing')?.has('assetId')).toBe(false);
    expect(readElement(elements.get('location-missing')!)).toMatchObject({
      name: 'Stazione Centrale',
    });
  });

  it('remaps nested video provenance and drops sources of videos not imported', () => {
    const doc = createBoardDoc(oldBoard);
    for (const type of ['frame', 'image'] as const) {
      for (const [suffix, assetId] of [
        ['stored', file],
        ['missing', elsewhere],
      ]) {
        addElement(doc, {
          ...base,
          id: `${type}-${suffix}`,
          type,
          assetId: file,
          source: { kind: 'uploaded-video', assetId: assetId!, timeSeconds: 1.125 },
        });
      }
    }
    addElement(doc, {
      ...base,
      id: 'link-still',
      type: 'image',
      assetId: file,
      source: { kind: 'link-thumbnail', url: 'https://vimeo.com/123' },
    });
    remapDoc(doc, newBoard, {
      boards: new Map(),
      assets: new Map([[file, newFile]]),
      person: () => importer,
    });
    for (const type of ['frame', 'image']) {
      expect(roots(doc).elements.get(`${type}-stored`)?.get('source')).toEqual({
        kind: 'uploaded-video',
        assetId: newFile,
        timeSeconds: 1.125,
      });
      expect(roots(doc).elements.get(`${type}-missing`)?.has('source')).toBe(false);
    }
    expect(roots(doc).elements.get('link-still')?.get('source')).toEqual({
      kind: 'link-thumbnail',
      url: 'https://vimeo.com/123',
    });
  });

  it('rewrites files, boards, the board itself and authors, keeping element ids and image crop/rotation', () => {
    const doc = createBoardDoc(oldBoard);
    addElement(doc, {
      ...base,
      id: 'image-0001',
      type: 'image',
      assetId: file,
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5, aspect: '1:1' },
      rotation: 90,
    });
    const badImg = addElement(doc, { ...base, id: 'image-0002', type: 'image', assetId: file });
    badImg.set('crop', { x: -1, y: 0, w: 2, h: 1 });
    badImg.set('rotation', 999);
    addElement(doc, { ...base, id: 'board-0001', type: 'board', boardId: child });
    addElement(doc, {
      ...base,
      id: 'link-00001',
      type: 'link',
      url: 'https://example.com',
      imageAssetId: elsewhere,
    });
    remapDoc(doc, newBoard, {
      boards: new Map([[child, newChild]]),
      assets: new Map([[file, newFile]]),
      person: () => importer,
    });
    const { meta, elements } = roots(doc);
    expect(meta.get('boardId')).toBe(newBoard);
    const read = (id: string) => readElement(elements.get(id) as never);
    expect(read('image-0001')).toMatchObject({
      assetId: newFile,
      createdBy: importer,
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5, aspect: '1:1' },
      rotation: 90,
    });
    expect(read('image-0002')).toMatchObject({ assetId: newFile, createdBy: importer });
    expect((read('image-0002') as { crop?: unknown }).crop).toBeUndefined();
    expect((read('image-0002') as { rotation?: unknown }).rotation).toBeUndefined();
    expect(read('board-0001')).toMatchObject({ boardId: newChild });
    // Not in the archive: never left pointing at something of another project.
    // An optional picture that is not in the archive goes; it never points elsewhere.
    const link = read('link-00001') as { imageAssetId?: string };
    expect(link.imageAssetId).toBeUndefined();
    expect(JSON.stringify(read('link-00001'))).not.toContain(elsewhere);
  });
});

describe('remapMentions', () => {
  it('writes every mention as the plain name the archive gives', () => {
    const named = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
    const unnamed = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    expect(remapMentions(`Hi @{${named}} and @{${unnamed}}`, new Map([[named, 'Mara']]))).toBe(
      'Hi @Mara and @?',
    );
  });
});
