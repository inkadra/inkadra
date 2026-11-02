import type { Project } from '@inkadra/shared';
import { Button, Dialog, DialogActions, type DialogHandle, Select, TextField } from '@inkadra/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { createBoard } from '../board/boards.ts';

export function NewBoardDialog({
  open,
  projects,
  initialProject,
  onClose,
}: {
  open: boolean;
  /** Projects where the person can add a board, most recent first. */
  projects: Project[];
  /** Preselected project, e.g. the one open behind the dialog; else the last one picked. */
  initialProject?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = useId();
  const [project, setProject] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<DialogHandle>(null);

  // Every opening starts from what was clicked, in the most recent project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens, not on refresh.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setProject((current) =>
      initialProject && projects.some((p) => p.id === initialProject)
        ? initialProject
        : projects.some((p) => p.id === current)
          ? current
          : (projects[0]?.id ?? ''),
    );
    setError(null);
  }, [open]);

  const target = projects.find((p) => p.id === project);
  const dirty = !busy && !!title;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const board = await createBoard(target.id, target.rootBoardId, title.trim(), 'board');
      onClose();
      navigate(`/p/${target.id}/b/${board.id}`);
    } catch {
      setError(t('home.newBoard.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      ref={dialog}
      open={open}
      dirty={dirty}
      title={t('home.newBoard.title')}
      onClose={onClose}
    >
      <form onSubmit={submit} className="home-new">
        <div className="ink-field">
          <label htmlFor={projectId} className="ink-field__label">
            {t('home.newBoard.project')}
          </label>
          <Select
            id={projectId}
            className="ink-input"
            value={project}
            onChange={(e) => setProject(e)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          label={t('home.newBoard.name')}
          placeholder={t('home.newBoard.namePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={error}
          maxLength={200}
        />
        <DialogActions>
          <Button variant="ghost" onClick={() => dialog.current?.requestClose()}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !target || !title.trim()}>
            {t('home.newBoard.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
