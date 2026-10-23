import type { Project } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.post<Project>('/projects', { name });
      setName('');
      onCreated(project);
    } catch {
      setError(t('auth.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={t('project.dialogTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <TextField
          label={t('project.name')}
          placeholder={t('project.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          maxLength={120}
        />
        <DialogActions>
          <Button variant="ghost" onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {t('project.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
