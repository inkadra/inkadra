import Collaboration from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

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
  return fragment.toArray().every((n) => n instanceof Y.XmlElement && plainText(n).trim() === '');
}

export function plainText(node: Y.XmlElement | Y.XmlFragment | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]+>/g, '');
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
  codeBlock: 'pre',
  horizontalRule: 'hr',
  hardBreak: 'br',
};

function renderNode(node: unknown, key: number): ReactNode {
  if (node instanceof Y.XmlText) return renderText(node, key);
  if (!(node instanceof Y.XmlElement)) return null;
  const children = node.toArray().map((c, i) => renderNode(c, i));
  if (node.nodeName === 'heading') {
    const level = Number(node.getAttribute('level')) || 1;
    const Tag = (level <= 1 ? 'h3' : 'h4') as 'h3' | 'h4';
    return <Tag key={key}>{children}</Tag>;
  }
  const tag = BLOCKS[node.nodeName] ?? 'div';
  if (tag === 'hr' || tag === 'br') {
    const Void = tag as 'hr' | 'br';
    return <Void key={key} />;
  }
  const Tag = tag as 'p';
  return <Tag key={key}>{children}</Tag>;
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
      else if (base === 'link') {
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
      Collaboration.configure({ fragment }),
      Placeholder.configure({ placeholder: t('board.note.placeholder') }),
    ],
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'note-text note-text--editing', 'aria-label': t('board.note.label') },
      handleKeyDown: (_view, event) => {
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
