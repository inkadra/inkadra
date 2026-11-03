// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, it } from 'vitest';
import { toggleSelectedHeading } from './note.tsx';

it('applies a heading only to selected text, keeping the surrounding text as paragraphs', () => {
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Primo secondo terzo</p>' });
  try {
    editor.commands.setTextSelection({ from: 7, to: 14 });
    toggleSelectedHeading(editor);
    expect(editor.getHTML()).toBe('<p>Primo </p><h1>secondo</h1><p> terzo</p>');
  } finally {
    editor.destroy();
  }
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Y from 'yjs';
import { NoteBody } from './note.tsx';
import { NoteAppearance, NoteInk, TaskList, TaskItem, noteColor, selectedBlocks } from './note-format.ts';

it('formats a selected substring without recoloring neighbours, and rejects arbitrary CSS', () => {
  const editor = new Editor({extensions:[StarterKit,NoteAppearance,NoteInk,TaskList,TaskItem],content:'<p>Before selected after</p>'});
  editor.commands.setTextSelection({from:8,to:16});
  editor.chain().setMark('noteInk',{color:'teal',highlight:'pink'}).run();
  expect(editor.getHTML()).toContain('data-ink-color="teal"');
  selectedBlocks(editor).toggleHeading({level:2}).run();
  expect(editor.getHTML()).toMatch(/^<p>Before <\/p><h2>/);
  expect(editor.getHTML()).toMatch(/<p> after<\/p>$/);
  expect(noteColor('red;background:url(https://example.com)')).toBeUndefined();
  editor.destroy();
});
it('renders persistent alignment, task items and safe ink for both board and guest notes', () => {
  const doc = new Y.Doc(); const body = doc.getXmlFragment('body');
  const p = new Y.XmlElement('paragraph'); p.setAttribute('textAlign','right');
  const text = new Y.XmlText(); p.insert(0,[text]); body.insert(0,[p]);
  text.insert(0,'Selected',{noteInk:{color:'teal',highlight:'pink'},underline:{}});
  const html = renderToStaticMarkup(createElement(NoteBody,{fragment:body}));
  expect(html).toContain('text-align:right');
  expect(html).toContain('var(--ink-tag-teal)');
  expect(html).toContain('var(--ink-tag-pink-bg)');
  expect(html).toContain('<u>');
});
