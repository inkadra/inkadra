import { roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { projectPreview } from './board-preview.ts';

describe('persisted board preview', () => {
  it('handles empty boards and rejects corrupt persisted state', () => {
    expect(projectPreview()).toEqual({ assetIds: [], excerpts: [], elementCount: 0, drawing: [] });
    expect(() => projectPreview(new Uint8Array([255]))).toThrow();
  });
  it('projects actual rich text, orders deterministically and bounds output', () => {
    const doc = new Y.Doc();
    const { elements } = roots(doc);
    for (let i = 10; i >= 0; i--) {
      const map = new Y.Map<unknown>();
      elements.set(`element-${i}`, map);
      map.set('type', 'note');
      map.set('x', 0);
      map.set('y', i);
      map.set('assetId', `asset-${i}`);
      const fragment = new Y.XmlFragment();
      map.set('body', fragment);
      const paragraph = new Y.XmlElement('paragraph');
      fragment.insert(0, [paragraph]);
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, `Real note ${i} ${'a'.repeat(200)}`);
    }
    const state = Y.encodeStateAsUpdate(doc);
    const result = projectPreview(state);
    expect(result.elementCount).toBe(11);
    expect(result.assetIds).toEqual(['asset-0', 'asset-1', 'asset-2', 'asset-3']);
    expect(result.excerpts).toHaveLength(3);
    expect(result.excerpts[0]).toMatch(/^Real note 0/);
    expect(result.excerpts[0]).toHaveLength(160);
    result.assetIds.push('tampered');
    expect(projectPreview(state).assetIds).not.toContain('tampered');
    elements.clear();
    expect(projectPreview(Y.encodeStateAsUpdate(doc)).elementCount).toBe(0);
    doc.destroy();
  });
});
