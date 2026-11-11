// @vitest-environment happy-dom
import { addElement, checkCard, createBoardDoc, NOTE_BODY_SCHEMA } from '@inkadra/doc-schema';
import { Editor, getSchema, type JSONContent } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { expect, it } from 'vitest';
import type * as Y from 'yjs';
import { NOTE_EXTENSIONS } from './note.tsx';

/** Attribute names by node or mark name; `doc` and `text` are never stored as such. */
const stored = (types: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(types)
      .filter(([name]) => name !== 'doc' && name !== 'text')
      .map(([name, type]) => [name, Object.keys((type as { attrs: object }).attrs).sort()]),
  );
const known = (list: Record<string, readonly string[]>) =>
  Object.fromEntries(Object.entries(list).map(([name, attrs]) => [name, [...attrs].sort()]));

it('stores in note bodies the nodes, marks and attributes the strict check knows (decision 0101)', () => {
  const schema = getSchema(NOTE_EXTENSIONS);
  expect(stored(schema.nodes)).toEqual(known(NOTE_BODY_SCHEMA.nodes));
  expect(stored(schema.marks)).toEqual(known(NOTE_BODY_SCHEMA.marks));
});

it('keeps a note written by the editor known to the strict check', async () => {
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  const note = addElement(doc, {
    id: 'noteAAAAAAAAA',
    type: 'note',
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
  });
  const fragment = note.get('body') as Y.XmlFragment;
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...NOTE_EXTENSIONS, Collaboration.configure({ fragment })],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const text = (value: string, marks: JSONContent['marks'] = []): JSONContent => ({
    type: 'text',
    text: value,
    marks,
  });
  const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
  editor.commands.setContent({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [text('Sopralluogo')],
      },
      {
        type: 'paragraph',
        attrs: { textAlign: 'right' },
        content: [
          text('mappa', [
            {
              type: 'link',
              attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener', class: 'x' },
            },
          ]),
          text(' con ', [{ type: 'bold' }]),
          { type: 'mention', attrs: { id: 'u1', label: 'Anna' }, marks: [{ type: 'bold' }] },
          text(' luce', [{ type: 'noteInk', attrs: { color: 'blue', highlight: 'yellow' } }]),
          text(' no', [{ type: 'strike' }, { type: 'underline' }, { type: 'italic' }]),
          text(' f/2.8', [{ type: 'code' }]),
          { type: 'hardBreak' },
          text('dopo'),
        ],
      },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [text('roll()')] },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [paragraph(text('tre'))] }],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('punto'))] }] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('fatto'))] },
        ],
      },
      { type: 'blockquote', content: [paragraph(text('citazione'))] },
      { type: 'horizontalRule' },
    ],
  });
  // Yjs prints node names in lower case.
  const xml = fragment.toString().toLowerCase();
  for (const part of [
    'textalign',
    'language',
    'mention',
    'noteink',
    'taskitem',
    'orderedlist',
    'link',
  ])
    expect(xml).toContain(part);
  expect(checkCard(note)).toEqual({ status: 'known' });
  editor.destroy();
});
