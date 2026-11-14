// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { unsavedLocalBoards } from '../board/local-boards.ts';
import { signOut } from './sign-out.ts';

/**
 * Signing out deletes the person's board copies on this device (#791). When some hold edits
 * the server does not have yet (made offline, or refused at a size limit), it asks first:
 * staying signed in keeps them, and opening those boards online sends them.
 * `start` signs out, or asks; `dialog` must be rendered.
 */
export function useSignOut(
  userId: string | undefined,
  onFailed: () => void,
): { start: () => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const [unsaved, setUnsaved] = useState(0);
  const leave = () => void signOut(userId).catch(onFailed);
  const start = () => {
    if (!userId) return leave();
    void unsavedLocalBoards(userId)
      .catch(() => [])
      .then((boards) => (boards.length ? setUnsaved(boards.length) : leave()));
  };
  // Mounted only while it asks: a closed dialog's text would sit in every page.
  const dialog = unsaved > 0 && (
    <Dialog open={unsaved > 0} title={t('auth.signOutUnsaved.title')} onClose={() => setUnsaved(0)}>
      <p>{t('auth.signOutUnsaved.body', { count: unsaved })}</p>
      <DialogActions>
        <Button
          variant="danger"
          onClick={() => {
            setUnsaved(0);
            leave();
          }}
        >
          {t('auth.signOutUnsaved.confirm')}
        </Button>
        <Button variant="primary" autoFocus onClick={() => setUnsaved(0)}>
          {t('auth.signOutUnsaved.stay')}
        </Button>
      </DialogActions>
    </Dialog>
  );
  return { start, dialog };
}
