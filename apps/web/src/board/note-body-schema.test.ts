// @vitest-environment happy-dom
import {
  addElement,
  appendParagraph,
  checkCard,
  createBoardDoc,
  formatText,
  insertBlock,
  insertInline,
  joinBackward,
  NOTE_BODY_CONTENT,
  NOTE_BODY_SCHEMA,
  NOTE_MARK_DEFAULTS,
  NOTE_MARK_EXCLUDES,
  noteStructureIssues,
  removeNode,
  replaceText,
  setTaskChecked,
  setTextBlock,
  splitBlock,
  toggleList,
} from '@inkadra/doc-schema';
import { Editor, getSchema, type JSONContent } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
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

it('declares the content model of the editor, for clients that write notes without it', () => {
  const schema = getSchema(NOTE_EXTENSIONS);
  const model = Object.fromEntries(
    Object.entries(schema.nodes).map(([name, type]) => {
      const spec = type.spec;
      return [
        name,
        {
          content: spec.content ?? '',
          group: spec.group ?? '',
          inline: type.isInline,
          ...(spec.marks === undefined ? {} : { marks: spec.marks }),
        },
      ];
    }),
  );
  expect(model).toEqual(NOTE_BODY_CONTENT);
  const excludes = Object.fromEntries(
    Object.entries(schema.marks)
      .filter(([, type]) => type.spec.excludes !== undefined)
      .map(([name, type]) => [name, type.spec.excludes]),
  );
  expect(excludes).toEqual(NOTE_MARK_EXCLUDES);
  for (const [mark, defaults] of Object.entries(NOTE_MARK_DEFAULTS))
    for (const [attr, value] of Object.entries(defaults))
      expect(schema.marks[mark]?.create().attrs[attr]).toBe(value);
});

it('takes a note written with the doc-schema operations as it is, and edits only what it edits', async () => {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('body');
  doc.transact(() => {
    const first = appendParagraph(fragment).block;
    replaceText(first, 0, 0, 'Ferry timing');
    setTextBlock(first, 'heading', 2);
    const text = splitBlock(fragment.get(0) as Y.XmlElement, 12).block;
    replaceText(text, 0, 0, 'Leaves at 08:55, keep 12E ready.');
    formatText(text, 0, 6, 'bold', {});
    formatText(text, 10, 15, 'code', {});
    formatText(text, 17, 20, 'link', { ...NOTE_MARK_DEFAULTS.link, href: 'https://example.com' });
    insertInline(text, 16, 'mention', { id: 'u1', label: 'Anna' });
    insertInline(text, 33, 'hardBreak');
    // Split, then joined back: one text node again.
    const half = splitBlock(text, 8).block;
    joinBackward(half);
    const todo = splitBlock(text, 34).block;
    replaceText(todo, 0, 0, 'Radio the harbour');
    const task = toggleList(todo, 'taskList')?.block as Y.XmlElement;
    setTaskChecked(task.parent as Y.XmlElement, true);
    const second = splitBlock(task, 17).block;
    replaceText(second, 0, 0, 'Clear the frame');
    // A bullet list turned into a task list, and an empty item that leaves its list.
    const pier = splitBlock(second, 15).block;
    const lifted = splitBlock(pier, 0).block;
    replaceText(lifted, 0, 0, 'Pier');
    const bullets = toggleList(lifted, 'bulletList')?.block as Y.XmlElement;
    const rope = splitBlock(bullets, 4).block;
    replaceText(rope, 0, 0, 'Rope');
    toggleList(rope, 'taskList');
    const rule = insertBlock(fragment, null, 'horizontalRule');
    removeNode(fragment.get(fragment.length - 2) as Y.XmlElement);
    insertBlock(fragment, rule.block, 'noteImage', { assetId: 'asset-1' });
  });
  expect(noteStructureIssues(fragment)).toEqual([]);
  const before = fragment.toArray().map((node) => node.toString());
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...NOTE_EXTENSIONS, Collaboration.configure({ fragment })],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The editor's own document is valid for its schema (y-tiptap never deletes at bind: it would
  // project invalid content unchecked).
  expect(() => editor.state.doc.check()).not.toThrow();
  expect(fragment.toArray().map((node) => node.toString())).toEqual(before);
  const kinds = (editor.getJSON().content ?? []).map((node) => node.type);
  expect(kinds).toEqual(['heading', 'paragraph', 'taskList', 'taskList', 'noteImage', 'paragraph']);
  // One edit in the editor changes the heading only: everything the operations wrote is what the
  // editor would have written (y-tiptap rewrites a block that differs from its own form).
  editor.commands.insertContentAt(1, 'X');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const after = fragment.toArray().map((node) => node.toString());
  expect(after[0]).toContain('XFerry timing');
  expect(after.slice(1)).toEqual(before.slice(1));
  editor.destroy();
});
