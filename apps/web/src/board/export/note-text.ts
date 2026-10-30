// SPDX-License-Identifier: AGPL-3.0-only
import * as Y from 'yjs';
import type { NoteBlock } from './board-render.ts';

/**
 * The rich text of a note as print blocks: paragraphs, headings, list and task items, quotes
 * and code. Inline marks are dropped (decision 0037).
 */
export function noteBlocks(body: unknown): NoteBlock[] {
  if (!(body instanceof Y.XmlFragment)) return [];
  const blocks: NoteBlock[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook, list: 'bullet' | 'task' | null) => {
    if (!(node instanceof Y.XmlElement)) return;
    const name = node.nodeName;
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      for (const child of node.toArray()) walk(child, name === 'taskList' ? 'task' : 'bullet');
      return;
    }
    if (name === 'listItem' || name === 'taskItem') {
      const checked =
        name === 'taskItem'
          ? node.getAttribute('checked') === 'true' ||
            (node.getAttribute('checked') as unknown) === true
          : undefined;
      let first = true;
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlElement && child.nodeName === 'paragraph') {
          blocks.push({
            kind: 'li',
            text: inline(child),
            ...(first && checked !== undefined ? { checked } : {}),
          });
          first = false;
        } else walk(child, list);
      }
      return;
    }
    if (name === 'blockquote') {
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlElement) blocks.push({ kind: 'quote', text: inline(child) });
      }
      return;
    }
    if (name === 'heading') {
      const level = Number(node.getAttribute('level') ?? 1);
      blocks.push({ kind: level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: inline(node) });
      return;
    }
    if (name === 'codeBlock') {
      blocks.push({ kind: 'code', text: inline(node) });
      return;
    }
    if (name === 'horizontalRule') return;
    blocks.push({ kind: 'p', text: inline(node) });
  };
  for (const node of body.toArray()) walk(node, null);
  return blocks;
}

function inline(node: Y.XmlElement): string {
  let out = '';
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Array<{ insert: unknown }>) {
        if (typeof op.insert === 'string') out += op.insert;
      }
    } else if (child instanceof Y.XmlElement) {
      out += child.nodeName === 'hardBreak' ? '\n' : inline(child);
    }
  }
  return out;
}
