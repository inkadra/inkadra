import { noteImageAssetIds } from '@inkadra/doc-schema';
import Collaboration from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { isFeedbackKey } from '../feedback/state.ts';
import { NoteAppearance, NoteInk, noteColor, TaskItem, TaskList } from './note-format.ts';
import { NoteImageNode, NoteMention, NotePicture } from './note-nodes.tsx';

/**
 * Notes keep their rich text in a Y.XmlFragment (the ProseMirror document, as y-prosemirror
 * stores it). Only the note being edited mounts an editor; every other note is rendered
 * straight from the fragment, which keeps a board with hundreds of notes light.
 */

export function useFragment(fragment: Y.XmlFragment | null) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!fragment) return;
    fragment.observeDeep(bump);
    return () => fragment.unobserveDeep(bump);
  }, [fragment]);
}

export function NoteBody({ fragment }: { fragment: Y.XmlFragment }) {
  useFragment(fragment);
  const nodes = fragment.toArray();
  if (nodes.length === 0 || isEmpty(fragment)) return null;
  return <div className="note-text">{nodes.map((n, i) => renderNode(n, i))}</div>;
}

export function isEmpty(fragment: Y.XmlFragment): boolean {
  // A picture alone is content too: a note holding only one must not count as blank.
  return (
    noteImageAssetIds(fragment).length === 0 &&
    fragment.toArray().every((n) => n instanceof Y.XmlElement && plainText(n).trim() === '')
  );
}

export function plainText(node: Y.XmlElement | Y.XmlFragment | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]+>/g, '');
  if (node instanceof Y.XmlElement && node.nodeName === 'mention')
    return `@${node.getAttribute('label') ?? ''}`;
  return node
    .toArray()
    .map((c) => plainText(c as Y.XmlElement | Y.XmlText))
    .join(node instanceof Y.XmlElement && node.nodeName === 'paragraph' ? '' : '\n');
}

const BLOCKS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  taskList: 'ul',
  taskItem: 'li',
  codeBlock: 'pre',
  horizontalRule: 'hr',
  hardBreak: 'br',
};

function renderNode(node: unknown, key: number): ReactNode {
  if (node instanceof Y.XmlText) return renderText(node, key);
  if (!(node instanceof Y.XmlElement)) return null;
  const children = node.toArray().map((c, i) => renderNode(c, i));
  if (node.nodeName === 'mention')
    return (
      <span key={key} className="note-mention">
        @{node.getAttribute('label')}
      </span>
    );
  if (node.nodeName === 'noteImage')
    return (
      <figure key={key} className="note-picture">
        <NotePicture
          assetId={node.getAttribute('assetId') ?? null}
          alt={node.getAttribute('alt')}
        />
      </figure>
    );
  const align = node.getAttribute('textAlign');
  const style = ['left', 'center', 'right'].includes(align ?? '')
    ? { textAlign: align as 'left' | 'center' | 'right' }
    : undefined;
  if (node.nodeName === 'heading') {
    const level = Number(node.getAttribute('level')) || 1;
    const Tag = (level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
    return (
      <Tag key={key} style={style}>
        {children}
      </Tag>
    );
  }
  if (node.nodeName === 'taskItem')
    return (
      <li key={key} data-type="taskItem">
        <input
          type="checkbox"
          aria-label={plainText(node)}
          checked={String(node.getAttribute('checked')) === 'true'}
          disabled
        />
        <div>{children}</div>
      </li>
    );
  const tag = BLOCKS[node.nodeName] ?? 'div';
  if (tag === 'hr' || tag === 'br') {
    const Void = tag as 'hr' | 'br';
    return <Void key={key} />;
  }
  const Tag = tag as 'p';
  return (
    <Tag
      key={key}
      style={style}
      data-type={
        node.nodeName === 'taskList' || node.nodeName === 'taskItem' ? node.nodeName : undefined
      }
      data-checked={node.nodeName === 'taskItem' ? String(node.getAttribute('checked')) : undefined}
    >
      {children}
    </Tag>
  );
}

interface Delta {
  insert: unknown;
  attributes?: Record<string, unknown>;
}

function renderText(text: Y.XmlText, key: number): ReactNode {
  const delta = text.toDelta() as Delta[];
  return delta.map((d, i) => {
    if (typeof d.insert !== 'string') return null;
    let out: ReactNode = d.insert;
    const marks = d.attributes ?? {};
    for (const name of Object.keys(marks)) {
      const base = name.split('--')[0];
      if (base === 'bold') out = <strong>{out}</strong>;
      else if (base === 'italic') out = <em>{out}</em>;
      else if (base === 'underline') out = <u>{out}</u>;
      else if (base === 'strike') out = <s>{out}</s>;
      else if (base === 'code') out = <code>{out}</code>;
      else if (base === 'noteInk') {
        const ink = marks[name] as { color?: string; highlight?: string } | null;
        out = (
          <span
            style={{
              color: noteColor(ink?.color),
              backgroundColor: noteColor(ink?.highlight, true),
            }}
          >
            {out}
          </span>
        );
      } else if (base === 'link') {
        const href = (marks[name] as { href?: string } | null)?.href;
        if (href && /^(https?:|mailto:)/i.test(href)) {
          out = (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {out}
            </a>
          );
        }
      }
    }
    // biome-ignore lint/suspicious/noArrayIndexKey: deltas have no identity of their own
    return <span key={`${key}-${i}`}>{out}</span>;
  });
}

/** Writes plain text into an empty fragment, one paragraph per line. */
export function fillFragment(fragment: Y.XmlFragment, text: string) {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  fragment.insert(
    fragment.length,
    paragraphs.map((line) => {
      const p = new Y.XmlElement('paragraph');
      if (line) p.insert(0, [new Y.XmlText(line)]);
      return p;
    }),
  );
}

export function NoteEditor({
  fragment,
  onReady,
  onExit,
}: {
  fragment: Y.XmlFragment;
  onReady?: (editor: Editor) => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Collaboration brings its own undo history, scoped to this note.
        undoRedo: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      NoteAppearance,
      NoteInk,
      TaskList,
      TaskItem,
      NoteMention,
      NoteImageNode,
      Collaboration.configure({ fragment }),
      Placeholder.configure({ placeholder: t('board.note.placeholder') }),
    ],
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'note-text note-text--editing', 'aria-label': t('board.note.label') },
      handleKeyDown: (_view, event) => {
        // Reporting owns this chord, including when the reporting destination is off.
        if (isFeedbackKey(event)) {
          event.preventDefault();
          return true;
        }
        if (event.key === 'Escape') {
          onExit();
          return true;
        }
        return false;
      },
    },
  });
  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);
  return <EditorContent editor={editor} />;
}

export function toggleSelectedHeading(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { from, to, empty, $from, $to } = tr.selection;
      // A heading is a block: isolate a partial selection before changing its node type.
      if (!empty && $from.sameParent($to) && $from.parent.type.name === 'paragraph') {
        if ($to.parentOffset < $to.parent.content.size) tr.split(to);
        const splitStart = $from.parentOffset > 0;
        if (splitStart) tr.split(from);
        tr.setSelection(
          TextSelection.create(tr.doc, from + (splitStart ? 2 : 0), to + (splitStart ? 2 : 0)),
        );
      }
      return true;
    })
    .toggleHeading({ level: 1 })
    .run();
}
