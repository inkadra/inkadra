// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadKept, keptBoards, unsavedLocalBoards } from '../board/local-boards.ts';
import { signOut } from './sign-out.ts';

/**
 * Signing out deletes the person's board copies on this device (#791). When some hold edits
 * the server does not have yet (made offline, or set aside because the server would not take
 * them), it asks first: staying signed in keeps them, and opening those boards online sends
 * what was made offline. What was set aside can only be downloaded, here or on its board.
 * `start` signs out, or asks; `dialog` must be rendered.
 */
export function useSignOut(
  userId: string | undefined,
  onFailed: () => void,
): { start: () => void; dialog: ReactNode } {
  const { t } = useTranslation();
  // Boards with edits made offline, which opening online saves, and boards with edits set aside.
  const [unsaved, setUnsaved] = useState(0);
  const [kept, setKept] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const leave = () => void signOut(userId).catch(onFailed);
  const count = (id: string) =>
    Promise.all([
      unsavedLocalBoards(id).catch((): string[] => []),
      keptBoards(id).catch((): string[] => []),
    ]).then(([boards, aside]) => {
      setKept(aside);
      setUnsaved(boards.filter((board) => !aside.includes(board)).length);
      return boards.length;
    });
  const start = () => {
    if (!userId) return leave();
    void count(userId).then((boards) => {
      if (!boards) leave();
    });
  };
  const download = async () => {
    if (!userId) return;
    setDownloading(true);
    try {
      for (const board of kept) await downloadKept(userId, board).catch(() => {});
      await count(userId);
    } finally {
      setDownloading(false);
    }
  };
  // Mounted only while it asks: a closed dialog's text would sit in every page.
  const asking = unsaved > 0 || kept.length > 0;
  const stay = () => {
    setUnsaved(0);
    setKept([]);
  };
  const dialog = asking && (
    <Dialog open={asking} title={t('auth.signOutUnsaved.title')} onClose={stay}>
      {unsaved > 0 && <p>{t('auth.signOutUnsaved.body', { count: unsaved })}</p>}
      {kept.length > 0 && (
        <>
          <p>{t('auth.signOutUnsaved.kept', { count: kept.length })}</p>
          <p>
            <Button icon="download" busy={downloading} onClick={() => void download()}>
              {t('auth.signOutUnsaved.download')}
            </Button>
          </p>
        </>
      )}
      <DialogActions>
        <Button
          variant="danger"
          onClick={() => {
            stay();
            leave();
          }}
        >
          {t('auth.signOutUnsaved.confirm')}
        </Button>
        <Button variant="primary" autoFocus onClick={stay}>
          {t('auth.signOutUnsaved.stay')}
        </Button>
      </DialogActions>
    </Dialog>
  );
  return { start, dialog };
}
