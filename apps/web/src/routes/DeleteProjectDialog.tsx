import type { Project } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteProject } from './projects.ts';
import './settings.css';
import './transfer.css';

/**
 * Delete project…, for owners: everything goes, for every member, so the name has to be typed
 * before the button turns on. Archive and Export are offered as the ways to keep it.
 */
export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const matches = typed.trim() === project.name.trim();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !matches) return;
    setBusy(true);
    setError(false);
    try {
      await deleteProject(project.id);
      onDeleted();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={t('projectDelete.title', { name: project.name })}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form className="settings-form" onSubmit={submit}>
        <p>{t('projectDelete.body')}</p>
        <p className="ink-muted">{t('projectDelete.alternatives')}</p>
        <TextField
          label={t('projectDelete.confirmLabel')}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          onChange={(e) => setTyped(e.target.value)}
        />
        {error && (
          <p role="alert" className="transfer-error">
            {t('projectDelete.error')}
          </p>
        )}
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !matches}>
            {t('projectDelete.confirm')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
