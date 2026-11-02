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
