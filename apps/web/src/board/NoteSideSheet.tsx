import { Avatar, Button, IconButton, useBackdropClick } from '@inkadra/ui';
import type { Editor } from '@tiptap/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { useIsPhone } from '../lib/phone.ts';
import type { ConnectionStatus, SaveStore } from './connection.ts';
import { syncSummary } from './header-status.tsx';
import { NotePhoneTools, useKeyboardInset } from './NotePhoneTools.tsx';
import { NoteBody, NoteEditor, plainText } from './note.tsx';
import { type Peer, TYPING_PAUSE_MS, typingIn } from './presence.ts';
import type { BoardStore } from './store.ts';
import './note-sheet.css';

/** The live board around the note: who else writes in it, and whether changes are saved. */
export interface NoteLive {
  peers: readonly Peer[];
  presence: { writing: (elementId: string | null, typing: boolean) => void };
  saves: SaveStore;
  status: ConnectionStatus;
  projectId: string | undefined;
  boardId: string | undefined;
}

export function NoteSideSheet({
  noteId,
  store,
  readOnly,
  breadcrumb,
  onClose,
  onEditOnCanvas,
  onComments,
  live,
}: {
  noteId: string;
  store: BoardStore;
  readOnly: boolean;
  /** Titles from the project root to the note's board. */
  breadcrumb: string[];
  onClose: () => void;
  onEditOnCanvas: () => void;
  onComments?: () => void;
  live?: NoteLive;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const phone = useIsPhone();
  const body = store.map(noteId)?.get('body');
  const fragment = body instanceof Y.XmlFragment ? body : null;
  const count = useWordCount(fragment);
  const backdrop = useBackdropClick(onClose);
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

  const meta = (
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
  );

  return (
    <dialog
      ref={ref}
      className={`note-sidesheet${expanded ? ' note-sidesheet--expanded' : ''}${phone ? ' note-sidesheet--phone' : ''}`}
      aria-label={t('board.note.label')}
      data-chrome
      data-scroll
      {...backdrop}
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {phone ? (
        <PhoneNote
          noteId={noteId}
          store={store}
          fragment={fragment}
          readOnly={readOnly}
          onClose={onClose}
          meta={meta}
          live={live}
        />
      ) : (
        <>
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
              {meta}
              {fragment &&
                (readOnly ? (
                  <NoteBody fragment={fragment} />
                ) : (
                  <NoteEditor key={noteId} fragment={fragment} onExit={onClose} />
                ))}
            </article>
          </div>
        </>
      )}
    </dialog>
  );
}

/**
 * The note on a phone (mockup screen 4): back, the note's first line, more; who is typing and
 * whether it is saved; the text; the tools above the keyboard.
 */
function PhoneNote({
  noteId,
  store,
  fragment,
  readOnly,
  onClose,
  meta,
  live,
}: {
  noteId: string;
  store: BoardStore;
  fragment: Y.XmlFragment | null;
  readOnly: boolean;
  onClose: () => void;
  meta: ReactNode;
  live: NoteLive | undefined;
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inset = useKeyboardInset();
  const title = useFirstLine(fragment) || t('board.note.label');
  const writers = live ? typingIn(live.peers, noteId) : [];
  const writing = live?.presence.writing;
  const editable = !readOnly && !!fragment;

  // Others see this note as being written in, and as typing until a short pause.
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!writing || !editable) return;
    writing(noteId, false);
    return () => {
      clearTimeout(pause.current);
      writing(null, false);
    };
  }, [writing, editable, noteId]);
  const typed = useCallback(() => {
    if (!writing) return;
    writing(noteId, true);
    clearTimeout(pause.current);
    pause.current = setTimeout(() => writing(noteId, false), TYPING_PAUSE_MS);
  }, [writing, noteId]);

  return (
    <>
      <header className="note-sidesheet__header note-phone__header">
        <IconButton icon="chevronLeft" label={t('shells.close')} onClick={onClose} />
        <h2 className="note-phone__title">{title}</h2>
        <IconButton
          icon="more"
          label={t('board.note.more')}
          aria-expanded={more}
          aria-controls={`${noteId}-more`}
          onClick={() => setMore(!more)}
        />
      </header>
      <div
        className="note-sidesheet__content"
        style={editable ? { paddingBottom: 60 + inset } : undefined}
      >
        <article className="note-sidesheet__doc" onInput={typed}>
          {more && <div id={`${noteId}-more`}>{meta}</div>}
          <div className="note-phone__status">
            <span className="note-phone__typing" aria-live="polite">
              {writers[0] && (
                <>
                  <Avatar name={writers[0].user.name} image={writers[0].user.image} size={24} />
                  {writers.length === 1
                    ? t('board.note.typingOne', { name: writers[0].user.name })
                    : t('board.note.typingMany', {
                        names: writers.map((w) => w.user.name).join(', '),
                      })}
                </>
              )}
            </span>
            {live && <SavedLabel live={live} readOnly={readOnly} />}
          </div>
          {error && (
            <p role="alert" className="note-phone__error">
              {error}
            </p>
          )}
          {fragment &&
            (readOnly ? (
              <NoteBody fragment={fragment} />
            ) : (
              <NoteEditor key={noteId} fragment={fragment} onExit={onClose} onReady={setEditor} />
            ))}
        </article>
      </div>
      {editable && (
        <NotePhoneTools
          editor={editor}
          store={store}
          projectId={live?.projectId}
          boardId={live?.boardId}
          inset={inset}
          onError={setError}
        />
      )}
    </>
  );
}

function SavedLabel({ live, readOnly }: { live: NoteLive; readOnly: boolean }) {
  const { t } = useTranslation();
  const { pending, savedAt } = useSyncExternalStore(
    live.saves.subscribe,
    live.saves.get,
    live.saves.get,
  );
  const summary = syncSummary({ status: live.status, readOnly, pending, savedAt }, 0);
  return (
    <span className="note-phone__saved">
      {summary.kind === 'saved' ? t('board.status.saved') : t(`board.status.${summary.kind}`)}
    </span>
  );
}

/** The note's first line, for the phone header. */
function useFirstLine(fragment: Y.XmlFragment | null): string {
  const read = useCallback(
    () => (fragment ? (plainText(fragment).trim().split('\n')[0] ?? '').slice(0, 80) : ''),
    [fragment],
  );
  const [line, setLine] = useState(read);
  useEffect(() => {
    if (!fragment) return;
    setLine(read());
    const update = () => setLine(read());
    fragment.observeDeep(update);
    return () => fragment.unobserveDeep(update);
  }, [fragment, read]);
  return line;
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
