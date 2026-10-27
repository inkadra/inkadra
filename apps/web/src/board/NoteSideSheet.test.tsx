// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { NoteSideSheet } from './NoteSideSheet.tsx';
import { fillFragment } from './note.tsx';
import { BoardStore } from './store.ts';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const disposals: Array<() => void> = [];
beforeEach(() => {
  // happy-dom does not implement the native modal API.
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
    this.querySelector('button')?.focus();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
function noteWith(text: string) {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const fragment = store.map(note.id)?.get('body') as Y.XmlFragment;
  fillFragment(fragment, text);
  return { store, note, fragment };
}
function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === label);
}

it('opens the actual note fragment in the existing editor and keeps canvas editing accessible', async () => {
  const { store, note } = noteWith('The real production note');
  const onEdit = vi.fn();
  const onComments = vi.fn();
  const onClose = vi.fn();
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly={false}
      breadcrumb={['Production', 'Act one', 'Storyboard']}
      onClose={onClose}
      onComments={onComments}
      onEditOnCanvas={onEdit}
    />,
  );
  const dialog = host.querySelector('dialog');
  // A stable name: the note's first line changes as people type.
  expect(dialog?.getAttribute('aria-label')).toBe('board.note.label');
  expect(dialog?.hasAttribute('aria-labelledby')).toBe(false);
  const editor = host.querySelector('[contenteditable="true"]');
  expect(editor?.textContent).toBe('The real production note');
  // The first line shows once, in the document itself.
  expect(host.textContent?.split('The real production note')).toHaveLength(2);
  const crumbs = [...host.querySelectorAll('nav ol > li')];
  expect(crumbs.map((li) => li.lastChild?.textContent)).toEqual([
    'Production',
    'Act one',
    'Storyboard',
  ]);
  expect(host.querySelectorAll('nav [aria-hidden="true"]')).toHaveLength(2);
  expect(host.textContent).toContain('shells.noteWords:4');

  const expand = host.querySelector<HTMLButtonElement>('[aria-pressed]');
  expect(expand?.textContent).toBe('shells.noteExpand');
  await act(async () => expand?.click());
  expect(dialog?.classList.contains('note-sidesheet--expanded')).toBe(true);
  expect(expand?.getAttribute('aria-pressed')).toBe('true');
  expect(expand?.textContent).toBe('shells.noteExpand');
  expect(host.querySelector('[contenteditable="true"]')).toBe(editor);
  await act(async () => expand?.click());
  expect(dialog?.classList.contains('note-sidesheet--expanded')).toBe(false);

  await act(async () => button(host, 'comments.open')?.click());
  expect(onComments).toHaveBeenCalledOnce();
  await act(async () => {
    dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => button(host, 'shells.editOnCanvas')?.click());
  expect(onEdit).toHaveBeenCalledOnce();
});

it('closes when Escape is pressed inside the editor', async () => {
  const { store, note } = noteWith('Escape me');
  const onClose = vi.fn();
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly={false}
      breadcrumb={['Storyboard']}
      onClose={onClose}
      onEditOnCanvas={vi.fn()}
    />,
  );
  const editor = host.querySelector('[contenteditable="true"]');
  await act(async () => {
    editor?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows live note content without an editor, canvas editing or comments when read-only', async () => {
  const { store, note, fragment } = noteWith('Shared note');
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly
      breadcrumb={['Shared board']}
      onClose={vi.fn()}
      onEditOnCanvas={vi.fn()}
    />,
  );
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(host.textContent).toContain('Shared note');
  expect(button(host, 'shells.editOnCanvas')).toBeUndefined();
  expect(button(host, 'comments.open')).toBeUndefined();
  await act(async () => {
    fillFragment(fragment, 'Remote update arrives now');
  });
  expect(host.textContent).toContain('Remote update arrives now');
  // The word count settles shortly after the last change rather than on every keystroke.
  expect(host.textContent).toContain('shells.noteWords:2');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(host.textContent).toContain('shells.noteWords:6');
});

it('restores the opener focus when the sheet unmounts', async () => {
  const { store, note } = noteWith('');
  const opener = document.createElement('button');
  document.body.append(opener);
  disposals.push(() => opener.remove());
  opener.focus();
  await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly
      breadcrumb={[]}
      onClose={vi.fn()}
      onEditOnCanvas={vi.fn()}
    />,
  );
  expect(document.activeElement).not.toBe(opener);
  disposals.pop()?.();
  expect(document.activeElement).toBe(opener);
});
