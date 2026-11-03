// SPDX-License-Identifier: AGPL-3.0-only
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

export const TEXT_COLORS = ['blue', 'orange', 'purple', 'green', 'teal', 'yellow', 'red', 'pink'] as const;
export function noteColor(value: unknown, highlight = false): string | undefined {
  return typeof value === 'string' && (TEXT_COLORS as readonly string[]).includes(value)
    ? `var(--ink-tag-${value}${highlight ? '-bg' : ''})` : undefined;
}
export const NoteAppearance = Extension.create({
  name: 'noteAppearance',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      textAlign: { default: null, parseHTML: el => ['left','center','right'].includes(el.style.textAlign) ? el.style.textAlign : null,
        renderHTML: attrs => ['left','center','right'].includes(attrs.textAlign) ? { style: `text-align:${attrs.textAlign}` } : {} },
    } }];
  },
});
export const NoteInk = Mark.create({
  name: 'noteInk',
  addAttributes() { return {
    color: { default: null, parseHTML: el => el.dataset.inkColor },
    highlight: { default: null, parseHTML: el => el.dataset.inkHighlight },
  }; },
  parseHTML() { return [{ tag: 'span[data-ink-color]' }, { tag: 'span[data-ink-highlight]' }]; },
  renderHTML({ HTMLAttributes }) {
    const { color, highlight } = HTMLAttributes;
    return ['span', { 'data-ink-color': color, 'data-ink-highlight': highlight,
      style: `${noteColor(color) ? `color:${noteColor(color)};` : ''}${noteColor(highlight,true) ? `background-color:${noteColor(highlight,true)};` : ''}` }, 0];
  },
});
export const TaskList = Node.create({
  name: 'taskList', group: 'block list', content: 'taskItem+',
  parseHTML() { return [{ tag: 'ul[data-type="taskList"]' }]; },
  renderHTML() { return ['ul', { 'data-type': 'taskList' }, 0]; },
});
export const TaskItem = Node.create({
  name: 'taskItem', content: 'paragraph block*', defining: true,
  addAttributes() { return { checked: { default: false, parseHTML: el => el.dataset.checked === 'true', renderHTML: attrs => ({ 'data-checked': attrs.checked }) } }; },
  parseHTML() { return [{ tag: 'li[data-type="taskItem"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['li', mergeAttributes(HTMLAttributes, { 'data-type': 'taskItem' }), 0]; },
  addKeyboardShortcuts() { return { Enter: () => this.editor.commands.splitListItem('taskItem'), Tab: () => this.editor.commands.sinkListItem('taskItem'), 'Shift-Tab': () => this.editor.commands.liftListItem('taskItem') }; },
});

/** Block formatting isolates a selected substring, so its neighbours keep their format. */
export function selectedBlocks(editor: Editor) {
  return editor.chain().focus().command(({ tr }) => {
    const { from, to, empty, $from, $to } = tr.selection;
    if (!empty && $from.sameParent($to) && ['paragraph','heading'].includes($from.parent.type.name)) {
      if ($to.parentOffset < $to.parent.content.size) tr.split(to);
      const split = $from.parentOffset > 0;
      if (split) tr.split(from);
      tr.setSelection(TextSelection.create(tr.doc, from + (split ? 2 : 0), to + (split ? 2 : 0)));
    }
    return true;
  });
}
