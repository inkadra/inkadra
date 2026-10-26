import { Button, Dialog } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { NoteBody, NoteEditor } from './note.tsx';
import type { BoardStore } from './store.ts';
import './note-sheet.css';

export function NoteSideSheet({
  noteId,
  store,
  readOnly,
  onClose,
  onEditOnCanvas,
}: {
  noteId: string;
  store: BoardStore;
  readOnly: boolean;
  onClose: () => void;
  onEditOnCanvas: () => void;
}) {
  const { t } = useTranslation();
  const body = store.map(noteId)?.get('body');
  return (
    <div data-chrome data-scroll>
      <Dialog open title={t('board.note.label')} onClose={onClose}>
        <Button onClick={onClose}>{t('shells.close')}</Button>
        {!readOnly && <Button onClick={onEditOnCanvas}>{t('shells.editOnCanvas')}</Button>}
        {body instanceof Y.XmlFragment &&
          (readOnly ? (
            <NoteBody fragment={body} />
          ) : (
            <NoteEditor key={noteId} fragment={body} onExit={onClose} />
          ))}
      </Dialog>
    </div>
  );
}
