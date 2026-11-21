import type { Project } from '@inkadra/shared';
import {
  Button,
  ChoiceTile,
  Dialog,
  DialogActions,
  type DialogHandle,
  Icon,
  kindStyle,
  Select,
  TextField,
} from '@inkadra/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { boardKindChoices, type NewBoardKind } from '../board/board-kinds.ts';
import { boardPath, createBoard, productionOf, useProjectBoards } from '../board/boards.ts';
import { kindIcon } from '../board/views.ts';
import { setModule, useModules } from '../lib/modules.ts';
import { addBoard } from './add-storyboard.ts';

const kindName = (kind: NewBoardKind) =>
  kind === 'board' ? 'board.types.board' : `film.views.${kind}`;

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
  const { offers } = useModules();
  const projectId = useId();
  const kindGroup = useId();
  const [project, setProject] = useState('');
  const [kind, setKind] = useState<NewBoardKind>('board');
  const [title, setTitle] = useState('');
  /** The person typed the name: picking another kind no longer replaces it. */
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<DialogHandle>(null);

  // Every opening starts from what was clicked, in the most recent project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens, not on refresh.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setEdited(false);
    setKind('board');
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
  const production = productionOf(useProjectBoards(target?.id).items);
  // The same kinds as the Canvas menu: by the modules that are on, one Production per project.
  const choices = boardKindChoices(offers, !!production);
  const chosen = choices.find((c) => c.kind === kind);
  /** The one Production board is there: the dialog opens it instead (decision 0123). */
  const opens = !!chosen?.present && !!production;
  // A name the dialog proposed is not the person's: closing does not ask about it.
  const dirty = !busy && edited && !!title.trim();

  const pick = (next: NewBoardKind) => {
    setKind(next);
    if (!edited || !title.trim()) setTitle(next === 'board' ? '' : t(kindName(next)));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || chosen?.off) return;
    if (opens) {
      onClose();
      navigate(boardPath(target.id, production.id, target.rootBoardId));
      return;
    }
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const to =
        kind === 'board'
          ? `/p/${target.id}/b/${(await createBoard(target.id, target.rootBoardId, title.trim(), 'board')).id}`
          : await addBoard(target, kind, t, title.trim());
      onClose();
      navigate(to);
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
        <fieldset className="home-new__kinds">
          <legend className="ink-field__label">{t('home.newBoard.kind')}</legend>
          <div className="home-new__kind-list">
            {choices.map((c) => (
              <ChoiceTile
                key={c.kind}
                variant="card"
                name={kindGroup}
                value={c.kind}
                className="home-new__kind"
                checked={kind === c.kind}
                disabled={c.off}
                onChange={() => pick(c.kind)}
              >
                <span className="home-new__kind-name" style={kindStyle(c.kind)}>
                  <Icon name={kindIcon(c.kind)} size={14} />
                  {t(kindName(c.kind))}
                </span>
                <small className="home-new__kind-desc">
                  {t(
                    c.off
                      ? 'modules.off'
                      : c.present
                        ? 'board.canvasMenu.present'
                        : `board.canvasMenu.desc.${c.kind}`,
                  )}
                </small>
              </ChoiceTile>
            ))}
          </div>
          {/* A module that is off stays in the list, dimmed, with its Turn on (decision 0121). */}
          {choices.flatMap(({ kind: k, off, owner }) =>
            off && owner
              ? [
                  <Button
                    key={k}
                    variant="ghost"
                    icon="plus"
                    className="home-new__turn-on"
                    onClick={() =>
                      void setModule(owner, true).catch(() => setError(t('modules.failed')))
                    }
                  >
                    {t('home.newBoard.turnOn', { name: t(kindName(k)) })}
                  </Button>,
                ]
              : [],
          )}
        </fieldset>
        {opens ? (
          <p className="home-new__present">{t('home.newBoard.present')}</p>
        ) : (
          <TextField
            label={t('home.newBoard.name')}
            placeholder={t('home.newBoard.namePlaceholder')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setEdited(true);
            }}
            error={error}
            maxLength={200}
          />
        )}
        <DialogActions>
          <Button variant="ghost" onClick={() => dialog.current?.requestClose()}>
            {t('project.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !target || !!chosen?.off || (!opens && !title.trim())}
          >
            {opens
              ? t('home.newBoard.open', { name: t('film.views.production') })
              : t('home.newBoard.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
