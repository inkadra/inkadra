// SPDX-License-Identifier: AGPL-3.0-only
import { Icon, type IconName } from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoryboard } from './film/storyboard-data.ts';
import { toggleSelectedHeading } from './note.tsx';
import { useReviews } from './review-store.ts';
import type { BoardStore } from './store.ts';
import { startUpload } from './uploads.ts';

/**
 * The phone tools of a full-screen note (#110, mockup screen 4): a bar that stays above the
 * on-screen keyboard, the `/` menu (shot, to-do, picture) and `@` mentions.
 */

/** Height of the on-screen keyboard, from the visual viewport; 0 without one. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export interface Trigger {
  char: '@' | '/';
  query: string;
}

/** A `@` or `/` typed at the start of a word, and what follows it up to the caret. */
export function parseTrigger(before: string): Trigger | null {
  const match = /(?:^|\s)([@/])([^\s@/]{0,30})$/u.exec(before);
  if (!match) return null;
  return { char: match[1] as '@' | '/', query: match[2] ?? '' };
}

interface Found extends Trigger {
  from: number;
  to: number;
}

function findTrigger(editor: Editor): Found | null {
  const { selection } = editor.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;
  const { $from } = selection;
  // Mentions and other atoms read as a placeholder, so `@Giulia /` still starts a menu.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const trigger = parseTrigger(before);
  if (!trigger) return null;
  return { ...trigger, from: $from.pos - trigger.query.length - 1, to: $from.pos };
}

interface Item {
  key: string;
  icon?: IconName;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** The menu's state follows the editor: it opens on a trigger and closes when it is gone. */
function useTrigger(editor: Editor | null) {
  const [found, setFound] = useState<Found | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!editor) return;
    const read = () => setFound(editor.isFocused ? findTrigger(editor) : null);
    editor.on('transaction', read);
    editor.on('focus', read);
    editor.on('blur', read);
    return () => {
      editor.off('transaction', read);
      editor.off('focus', read);
      editor.off('blur', read);
    };
  }, [editor]);
  const open = found && found.from !== dismissed ? found : null;
  return { found: open, dismiss: () => setDismissed(found?.from ?? null) };
}

export function NotePhoneTools({
  editor,
  store,
  projectId,
  boardId,
  inset,
  onError,
}: {
  editor: Editor | null;
  store: BoardStore;
  projectId: string | undefined;
  boardId: string | undefined;
  inset: number;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const people = useReviews((s) => s.people);
  const { frames, labels } = useStoryboard(store);
  const { found, dismiss } = useTrigger(editor);
  const [pickingFrame, setPickingFrame] = useState(false);
  const [active, setActive] = useState(0);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!editor) return;
    // Pressed states follow the selection.
    const bump = () => rerender((n) => n + 1);
    editor.on('selectionUpdate', bump);
    editor.on('transaction', bump);
    return () => {
      editor.off('selectionUpdate', bump);
      editor.off('transaction', bump);
    };
  }, [editor]);
  const query = found?.query.toLocaleLowerCase() ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new menu starts at its first item
  useEffect(() => setActive(0), [found?.char, query, pickingFrame]);

  const pickPicture = useCallback(() => file.current?.click(), []);

  const insertPicture = (picked: File) => {
    if (!editor || !projectId || !boardId) return;
    startUpload({
      file: picked,
      projectId,
      boardId,
      onAsset: (assetId) =>
        editor.chain().focus().insertContent({ type: 'noteImage', attrs: { assetId } }).run(),
      onFailed: () => onError(t('board.note.pictureFailed')),
      onCancelled: (assetId) => {
        if (!assetId) return;
        editor.commands.command(({ tr, state }) => {
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'noteImage' && node.attrs.assetId === assetId)
              tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
          });
          return true;
        });
      },
    });
  };

  const clearTrigger = () => {
    if (editor && found)
      editor.chain().focus().deleteRange({ from: found.from, to: found.to }).run();
  };

  let items: Item[] = [];
  let listLabel = '';
  if (editor && pickingFrame) {
    listLabel = t('board.note.slash.frame');
    items = frames.map((frame) => {
      const label = labels.get(frame.id) ?? t('board.types.frame');
      return {
        key: frame.id,
        icon: 'film',
        label,
        ...(frame.action ? { hint: frame.action } : {}),
        run: () => {
          const href =
            projectId && boardId
              ? `${window.location.origin}/p/${projectId}/b/${boardId}?el=${encodeURIComponent(frame.id)}&view=canvas`
              : null;
          editor
            .chain()
            .focus()
            .insertContent([
              {
                type: 'text',
                text: label,
                ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
              },
              { type: 'text', text: ' ' },
            ])
            .run();
          setPickingFrame(false);
        },
      };
    });
  } else if (editor && found?.char === '/') {
    listLabel = t('board.note.slash.label');
    items = [
      {
        key: 'frame',
        icon: 'film' as const,
        label: t('board.note.slash.frame'),
        hint: frames.length ? t('board.note.slash.frameHint') : t('board.note.slash.noFrames'),
        disabled: frames.length === 0,
        run: () => {
          clearTrigger();
          setPickingFrame(true);
        },
      },
      {
        key: 'todo',
        icon: 'todo' as const,
        label: t('board.note.slash.todo'),
        hint: t('board.note.slash.todoHint'),
        run: () => {
          clearTrigger();
          editor.chain().focus().toggleList('taskList', 'taskItem').run();
        },
      },
      {
        key: 'image',
        icon: 'image' as const,
        label: t('board.note.slash.image'),
        hint: t('board.note.slash.imageHint'),
        disabled: !projectId || !boardId,
        run: () => {
          clearTrigger();
          pickPicture();
        },
      },
    ].filter((item) => item.label.toLocaleLowerCase().startsWith(query));
  } else if (editor && found?.char === '@') {
    listLabel = t('board.note.mentions');
    items = people
      .filter((p) => p.name.toLocaleLowerCase().includes(query))
      .slice(0, 6)
      .map((person) => ({
        key: person.id,
        label: person.name,
        run: () => {
          editor
            .chain()
            .focus()
            .insertContentAt({ from: found.from, to: found.to }, [
              { type: 'mention', attrs: { id: person.id, label: person.name } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      }));
  }
  const open = items.length > 0 || pickingFrame;
  const enabled = items.filter((item) => !item.disabled);

  /** Arrow keys, Enter and Escape drive the menu before the editor sees them. */
  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPickingFrame(false);
      dismiss();
      return;
    }
    if (enabled.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((n) => (n + step + enabled.length) % enabled.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      enabled[active]?.run();
    }
  };

  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useEffect(() => {
    // Captured on the editor's wrapper, so the menu goes before ProseMirror's own keys.
    const host = editor?.view.dom.parentElement;
    if (!host) return;
    const listen = (event: globalThis.KeyboardEvent) => keys.current(event);
    host.addEventListener('keydown', listen, true);
    return () => host.removeEventListener('keydown', listen, true);
  }, [editor]);

  const tool = (
    key: string,
    label: string,
    content: ReactNode,
    run: () => void,
    pressed?: boolean,
  ) => (
    <button
      key={key}
      type="button"
      className="note-phone-bar__tool"
      aria-label={label}
      aria-pressed={pressed}
      disabled={!editor}
      // The editor keeps the focus, and so the phone keeps its keyboard.
      onPointerDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {content}
    </button>
  );
  const chain = () => editor?.chain().focus();

  return (
    <div className="note-phone-tools">
      {open && (
        <div
          id={`${id}-menu`}
          className="note-phone-menu"
          role="listbox"
          aria-label={listLabel}
          style={{ transform: `translateY(${-inset}px)` }}
        >
          {items.length === 0 && (
            <p className="note-phone-menu__empty">{t('board.note.slash.noFrames')}</p>
          )}
          {items.map((item) => {
            const index = enabled.indexOf(item);
            return (
              <button
                key={item.key}
                id={`${id}-item-${item.key}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                aria-disabled={item.disabled || undefined}
                className="note-phone-menu__item"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => !item.disabled && item.run()}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                <span>
                  {item.label}
                  {item.hint && <small>{item.hint}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        className="note-phone-bar"
        role="toolbar"
        aria-label={t('board.note.toolbar')}
        style={{ transform: `translateY(${-inset}px)` }}
      >
        {tool(
          'style',
          t('board.note.style'),
          <span aria-hidden="true">Aa</span>,
          () => editor && toggleSelectedHeading(editor),
          editor?.isActive('heading') ?? false,
        )}
        {tool(
          'bold',
          t('board.format.bold'),
          <Icon name="bold" size={18} />,
          () => chain()?.toggleBold().run(),
          editor?.isActive('bold') ?? false,
        )}
        {tool(
          'italic',
          t('board.format.italic'),
          <Icon name="italic" size={18} />,
          () => chain()?.toggleItalic().run(),
          editor?.isActive('italic') ?? false,
        )}
        {tool(
          'list',
          t('board.format.list'),
          <Icon name="list" size={18} />,
          () => chain()?.toggleBulletList().run(),
          editor?.isActive('bulletList') ?? false,
        )}
        {tool(
          'todo',
          t('board.contextual.taskList'),
          <Icon name="todo" size={18} />,
          () => chain()?.toggleList('taskList', 'taskItem').run(),
          editor?.isActive('taskList') ?? false,
        )}
        {tool('mention', t('board.note.mention'), <span aria-hidden="true">@</span>, () =>
          chain()
            ?.insertContent(found ? ' @' : '@')
            .run(),
        )}
        {projectId &&
          boardId &&
          tool('image', t('board.note.slash.image'), <Icon name="image" size={18} />, pickPicture)}
        {tool(
          'slash',
          t('board.note.slash.label'),
          <span aria-hidden="true">/</span>,
          () =>
            chain()
              ?.insertContent(found ? ' /' : '/')
              .run(),
          found?.char === '/' || pickingFrame,
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) insertPicture(picked);
        }}
      />
    </div>
  );
}
