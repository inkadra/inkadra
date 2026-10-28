import type { Project } from '@inkadra/shared';
import { Button, Dialog, DialogActions, kindStyle, TextField } from '@inkadra/ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { createBoard } from '../board/boards.ts';

/** What Home offers to start from: the board templates of decision 0021, or nothing. */
export const START_CHOICES = ['production', 'moodboard', 'storyboard', 'blank'] as const;
export type StartChoice = (typeof START_CHOICES)[number];
export const choiceKey = (c: StartChoice, part: 'name' | 'body') =>
  c === 'blank' ? `home.templates.blank.${part}` : `templates.${c}.${part}`;

/**
 * A new board under a project's root board. The template is a one-time navigation request,
 * applied by the board page once the empty document has synced (decision 0021).
 */
export function NewBoardDialog({
  open,
  projects,
  initial,
  initialProject,
  onClose,
}: {
  open: boolean;
  /** Projects where the person can add a board, most recent first. */
  projects: Project[];
  initial: StartChoice;
  /** Preselected project, e.g. the one open behind the dialog; else the last one picked. */
  initialProject?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = useId();
  const [project, setProject] = useState('');
  const [choice, setChoice] = useState<StartChoice>(initial);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts from what was clicked, in the most recent project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens, not on refresh.
  useEffect(() => {
    if (!open) return;
    setChoice(initial);
    setTitle(initial === 'blank' ? '' : t(choiceKey(initial, 'name')));
    setProject((current) =>
      initialProject && projects.some((p) => p.id === initialProject)
        ? initialProject
        : projects.some((p) => p.id === current)
          ? current
          : (projects[0]?.id ?? ''),
    );
    setError(null);
  }, [open, initial]);

  const target = projects.find((p) => p.id === project);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const board = await createBoard(
        target.id,
        target.rootBoardId,
        title.trim(),
        choice === 'storyboard' ? 'storyboard' : 'board',
      );
      onClose();
      navigate(`/p/${target.id}/b/${board.id}`, {
        state: choice === 'blank' ? null : { template: choice },
      });
    } catch {
      setError(t('home.newBoard.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={t('home.newBoard.title')} onClose={onClose}>
      <form onSubmit={submit} className="home-new">
        <div className="ink-field">
          <label htmlFor={projectId} className="ink-field__label">
            {t('home.newBoard.project')}
          </label>
          <select
            id={projectId}
            className="ink-input"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="home-new__choices">
          <legend className="ink-field__label">{t('home.newBoard.start')}</legend>
          {START_CHOICES.map((c) => (
            <label key={c} className="home-new__choice" style={kindStyle(c)}>
              <input
                type="radio"
                name="start"
                value={c}
                checked={choice === c}
                onChange={() => {
                  // A title still matching the previous template follows the new one.
                  const previous = choice === 'blank' ? '' : t(choiceKey(choice, 'name'));
                  if (title === previous) setTitle(c === 'blank' ? '' : t(choiceKey(c, 'name')));
                  setChoice(c);
                }}
              />
              <span>
                <span className="home-new__name">{t(choiceKey(c, 'name'))}</span>
                <span className="ink-muted home-new__body">{t(choiceKey(c, 'body'))}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextField
          label={t('home.newBoard.name')}
          placeholder={t('home.newBoard.namePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={error}
          maxLength={200}
        />
        <DialogActions>
          <Button variant="ghost" onClick={onClose}>
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
