import type { GuestSession } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { guestApi } from './api.ts';

/**
 * Asked before the guest's first comment, review or pick (decision 0013): the name is shown to
 * the people who shared the board, always marked as a guest's.
 */
export function NameDialog({
  open,
  linkId,
  initial,
  onSaved,
  onCancel,
  onError,
}: {
  open: boolean;
  linkId: string;
  initial: string;
  onSaved: (session: GuestSession) => void;
  onCancel: () => void;
  onError: (err: unknown) => string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial);
    setError(null);
    requestAnimationFrame(() => form.current?.querySelector('input')?.focus());
  }, [open, initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(t('guest.name.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await guestApi.setName(linkId, value));
    } catch (err) {
      setError(onError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={t('guest.name.title')} onClose={onCancel}>
      <form ref={form} className="guest-name" onSubmit={submit}>
        <p className="ink-muted guest-name__body">{t('guest.name.body')}</p>
        <TextField
          label={t('guest.name.label')}
          value={name}
          maxLength={80}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          error={error}
        />
        <DialogActions>
          <Button onClick={onCancel} disabled={busy}>
            {t('guest.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('guest.name.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
