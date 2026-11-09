import type { Project } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon, Tooltip } from '@inkadra/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const id = useId();
  const matches = typed.trim() === project.name.trim();
  async function copy() {
    try {
      await navigator.clipboard.writeText(project.name);
    } catch {
      return; // No clipboard (permission, insecure origin): the name stays there to type.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }
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
        <p className="delete-project__warning">{t('projectDelete.irreversible')}</p>
        <div className="ink-field">
          {/* The sentence is the input's label; the chip copies the name to paste. */}
          <span className="ink-field__label delete-project__label">
            <span id={`${id}-before`}>{t('projectDelete.confirmBefore')}</span>
            <span className="delete-project__chip-wrap">
              <Tooltip content={copied ? undefined : t('projectDelete.copy', { name: project.name })}>
                <button
                  id={`${id}-name`}
                  type="button"
                  className={`delete-project__chip${copied ? ' is-copied' : ''}`}
                  disabled={busy}
                  onClick={copy}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={13} />
                  <span>{project.name}</span>
                </button>
              </Tooltip>
              <span role="status">
                {copied && (
                  <span className="ink-tooltip delete-project__copied">
                    {t('projectDelete.copied')}
                  </span>
                )}
              </span>
            </span>
            <span id={`${id}-after`}>{t('projectDelete.confirmAfter')}</span>
          </span>
          <input
            className="ink-input"
            aria-labelledby={`${id}-before ${id}-name ${id}-after`}
            placeholder={t('projectDelete.placeholder')}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: the dialog exists to type this name.
            autoFocus
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
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
