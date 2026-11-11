import { NOTE_BODY_SCHEMA } from '@inkadra/doc-schema';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, it } from 'vitest';
import { NoteAppearance, NoteInk, TaskItem, TaskList } from './note-format.ts';
import { NoteImageNode, NoteMention } from './note-nodes.tsx';

// The extensions of NoteEditor (note.tsx) that shape what a note body stores.
const schema = getSchema([
  StarterKit.configure({ undoRedo: false }),
  NoteAppearance,
  NoteInk,
  TaskList,
  TaskItem,
  NoteMention,
  NoteImageNode,
]);

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
  expect(stored(schema.nodes)).toEqual(known(NOTE_BODY_SCHEMA.nodes));
  expect(stored(schema.marks)).toEqual(known(NOTE_BODY_SCHEMA.marks));
});
