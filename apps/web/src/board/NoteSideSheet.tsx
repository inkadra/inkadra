import { Button } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { NoteBody, NoteEditor, plainText } from './note.tsx';
import type { BoardStore } from './store.ts';
import './note-sheet.css';

export function NoteSideSheet({
  noteId,
  store,
  readOnly,
  breadcrumb,
  onClose,
  onEditOnCanvas,
  onComments,
}: {
  noteId: string;
  store: BoardStore;
  readOnly: boolean;
  /** Titles from the project root to the note's board. */
  breadcrumb: string[];
  onClose: () => void;
  onEditOnCanvas: () => void;
  onComments?: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const body = store.map(noteId)?.get('body');
  const fragment = body instanceof Y.XmlFragment ? body : null;
  const count = useWordCount(fragment);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const fallback = dialog.closest<HTMLElement>('.canvas');
    dialog.showModal();
    return () => {
      // Closing before removal restores focus to the element that opened the sheet.
      if (dialog.open) dialog.close();
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
        previous.focus();
      } else if (fallback?.isConnected) {
        fallback.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`note-sidesheet${expanded ? ' note-sidesheet--expanded' : ''}`}
      aria-label={t('board.note.label')}
      data-chrome
      data-scroll
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="note-sidesheet__header">
        <nav className="note-sidesheet__breadcrumb" aria-label={t('shells.noteBreadcrumb')}>
          <ol>
            {breadcrumb.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered breadcrumb segments
              <li key={index}>
                {index > 0 && (
                  <span className="note-sidesheet__sep" aria-hidden="true">
                    /
                  </span>
                )}
                {part}
              </li>
            ))}
          </ol>
        </nav>
        <Button
          className="note-sidesheet__expand"
          aria-pressed={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t('shells.noteExpand')}
        </Button>
        <Button onClick={onClose}>{t('shells.close')}</Button>
      </header>
      <div className="note-sidesheet__content">
        <article className="note-sidesheet__doc">
          <div className="note-sidesheet__meta-row">
            <span>{t('shells.noteWords', { count })}</span>
            {!readOnly && (
              <Button
                icon="pen"
                className="note-sidesheet__action"
                data-ink-tooltip={t('shells.editOnCanvas')}
                onClick={onEditOnCanvas}
              >
                <span className="note-sidesheet__action-label">{t('shells.editOnCanvas')}</span>
              </Button>
            )}
            {onComments && (
              <Button
                icon="comment"
                className="note-sidesheet__action"
                data-ink-tooltip={t('comments.open')}
                onClick={onComments}
              >
                <span className="note-sidesheet__action-label">{t('comments.open')}</span>
              </Button>
            )}
          </div>
          {fragment &&
            (readOnly ? (
              <NoteBody fragment={fragment} />
            ) : (
              <NoteEditor key={noteId} fragment={fragment} onExit={onClose} />
            ))}
        </article>
      </div>
    </dialog>
  );
}

/** Words in the note, recounted shortly after typing pauses rather than on every keystroke. */
function useWordCount(fragment: Y.XmlFragment | null): number {
  const [count, setCount] = useState(() => (fragment ? countWords(fragment) : 0));
  useEffect(() => {
    if (!fragment) return;
    setCount(countWords(fragment));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recount = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setCount(countWords(fragment)), 200);
    };
    fragment.observeDeep(recount);
    return () => {
      clearTimeout(timer);
      fragment.unobserveDeep(recount);
    };
  }, [fragment]);
  return count;
}

function countWords(fragment: Y.XmlFragment): number {
  const text = plainText(fragment).trim();
  return text ? text.split(/\s+/u).length : 0;
}
