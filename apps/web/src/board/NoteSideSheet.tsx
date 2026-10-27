import { Button } from '@inkadra/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { NoteBody, NoteEditor, plainText, useFragment } from './note.tsx';
import type { BoardStore } from './store.ts';
import './note-sheet.css';

export function NoteSideSheet({
  noteId,
  store,
  readOnly,
  projectName,
  boardName,
  onClose,
  onEditOnCanvas,
  onComments,
}: {
  noteId: string;
  store: BoardStore;
  readOnly: boolean;
  projectName?: string;
  boardName?: string;
  onClose: () => void;
  onEditOnCanvas: () => void;
  onComments?: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const body = store.map(noteId)?.get('body');
  const fragment = body instanceof Y.XmlFragment ? body : null;
  useFragment(fragment);
  const text = fragment ? plainText(fragment).trim() : '';
  const title = text.split('\n').find((line) => line.trim()) || t('board.note.label');
  const count = text ? text.split(/\s+/u).length : 0;
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
      aria-labelledby={titleId}
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
          {[projectName, boardName, title].filter(Boolean).map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered breadcrumb segments
            <span key={index}>{part}</span>
          ))}
        </nav>
        <Button aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? 'shells.noteCollapse' : 'shells.noteExpand')}
        </Button>
        <Button onClick={onClose}>{t('shells.close')}</Button>
      </header>
      <div className="note-sidesheet__content">
        <article className="note-sidesheet__doc">
          <h2 id={titleId} className="note-sidesheet__title">
            {title}
          </h2>
          <div className="note-sidesheet__meta-row">
            <span>{t('shells.noteWords', { count })}</span>
            {!readOnly && <Button onClick={onEditOnCanvas}>{t('shells.editOnCanvas')}</Button>}
            {onComments && <Button onClick={onComments}>{t('comments.open')}</Button>}
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
