import { defaultProjectIcon, type Project, ProjectIcon, type z } from '@inkadra/shared';
import { Button, Dialog, DialogActions, NavItem, ProjectGlyph, TextField } from '@inkadra/ui';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { updateProjectAppearance } from './projects.ts';
import './project-appearance.css';

type Appearance = z.infer<typeof ProjectIcon>;
export const canEditProjectAppearance = (project: Pick<Project, 'myRole'>) =>
  project.myRole === 'owner' || project.myRole === 'editor';

/** Local project action menu; the later application-wide menu can reuse the dialog/action. */
export function ProjectNavItem({
  project,
  active,
  onClick,
}: {
  project: Project;
  active: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editable = canEditProjectAppearance(project);
  const close = () => {
    setMenu(null);
    opener.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    item.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !opener.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const open = (target: HTMLElement, x?: number, y?: number) => {
    opener.current = target;
    const rect = target.getBoundingClientRect();
    setMenu({
      x: Math.max(8, Math.min(x ?? rect.left, window.innerWidth - 240)),
      y: Math.max(8, Math.min(y ?? rect.bottom, window.innerHeight - 100)),
    });
  };
  return (
    <div className="project-navigation">
      <NavItem
        leading={<ProjectGlyph {...project.icon} />}
        label={project.name}
        href={`/p/${project.id}`}
        active={active}
        onClick={onClick}
        onContextMenu={
          editable
            ? (event) => {
                event.preventDefault();
                open(event.currentTarget, event.clientX, event.clientY);
              }
            : undefined
        }
        onKeyDown={
          editable
            ? (event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  open(event.currentTarget);
                }
              }
            : undefined
        }
      />
      {editable && (
        <button
          type="button"
          className="project-navigation__options"
          aria-label={t('appearance.options', { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => (menu ? close() : open(event.currentTarget))}
        >
          ⋯
        </button>
      )}
      {menu &&
        editable &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={project.name}
            className="project-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                }
                close();
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                item.current?.focus();
              }
            }}
          >
            <button
              ref={item}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                setEditing(true);
              }}
            >
              {t('appearance.title')}
            </button>
          </div>,
          opener.current?.closest('dialog') ?? document.body,
        )}
      {editing && (
        <ProjectAppearanceDialog
          project={project}
          onClose={() => {
            setEditing(false);
            opener.current?.focus();
          }}
        />
      )}
    </div>
  );
}

export function ProjectAppearanceDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}) {
  const { t } = useTranslation();
  const [icon, setIcon] = useState<Appearance>({ ...project.icon });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const allowed = canEditProjectAppearance(project);
  const valid = ProjectIcon.safeParse(icon).success;
  async function save() {
    if (!allowed || !valid || busy) return;
    setBusy(true);
    setError(false);
    try {
      const updated = await updateProjectAppearance(project.id, icon);
      onSaved?.(updated);
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`${t('appearance.title')} · ${project.name}`}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <form
        className="settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="project-appearance__preview">
          <ProjectGlyph {...icon} />
          <span>{project.name}</span>
        </div>
        <fieldset disabled={busy || !allowed}>
          <legend>{t('appearance.symbol')}</legend>
          <div className="project-appearance__choices">
            {ProjectIcon.shape.shape.options.map((shape) => (
              <label key={shape}>
                <input
                  type="radio"
                  name="projectShape"
                  value={shape}
                  checked={!icon.emoji && icon.shape === shape}
                  onChange={() => setIcon({ ...icon, shape, emoji: null })}
                />
                <ProjectGlyph shape={shape} color={icon.color} />
                {t(`appearance.shapes.${shape}`)}
              </label>
            ))}
          </div>
          <label className="settings__label">
            {t('appearance.color')}
            <select
              className="ink-input"
              value={icon.color}
              onChange={(event) =>
                setIcon({ ...icon, color: event.target.value as Appearance['color'] })
              }
            >
              {ProjectIcon.shape.color.options.map((color) => (
                <option key={color} value={color}>
                  {t(`appearance.colors.${color}`)}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label={t('appearance.emoji')}
            value={icon.emoji ?? ''}
            maxLength={32}
            placeholder="🎬"
            onChange={(event) => setIcon({ ...icon, emoji: event.target.value || null })}
          />
          <p className="ink-muted">{t('appearance.emojiHelp')}</p>
          {!valid && <p role="alert">{t('appearance.invalid')}</p>}
          <Button type="button" onClick={() => setIcon(defaultProjectIcon(project.id))}>
            {t('appearance.reset')}
          </Button>
        </fieldset>
        {error && <p role="alert">{t('appearance.error')}</p>}
        <DialogActions>
          <Button type="button" disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !allowed || !valid}>
            {t('settings.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
