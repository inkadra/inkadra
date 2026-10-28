import { defaultProjectIcon, type Project, ProjectIcon, type z } from '@inkadra/shared';
import { Button, Dialog, DialogActions, NavItem, ProjectGlyph, TextField } from '@inkadra/ui';
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { updateProjectAppearance } from './projects.ts';
import './project-appearance.css';

type Appearance = z.infer<typeof ProjectIcon>;
export const canEditProjectAppearance = (project: Pick<Project, 'myRole'>) =>
  project.myRole === 'owner' || project.myRole === 'editor';

export interface ProjectMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

/**
 * The ⋯ menu of a project, shared by the sidebar and the Projects page: project appearance
 * for editors, then the caller's own actions. Returns the trigger, the right-click handlers
 * and the layer (menu and dialog) so each place keeps its own markup.
 */
export function useProjectMenu(
  project: Project,
  extra: ProjectMenuItem[] = [],
  onSaved?: (project: Project) => void,
) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items: ProjectMenuItem[] = [
    ...(canEditProjectAppearance(project)
      ? [{ label: t('appearance.title'), action: () => setEditing(true) }]
      : []),
    ...extra,
  ];
  const enabled = items.length > 0;
  const close = () => {
    setMenu(null);
    opener.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
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
  /** Opens at `anchor`; focus returns to `focus` when the menu or its dialog closes. */
  const open = (anchor: HTMLElement, focus: HTMLElement | null, x?: number, y?: number) => {
    opener.current = focus;
    const rect = anchor.getBoundingClientRect();
    setMenu({
      x: Math.max(8, Math.min(x ?? rect.left, window.innerWidth - 240)),
      y: Math.max(8, Math.min(y ?? rect.bottom, window.innerHeight - 48 - items.length * 40)),
    });
  };
  // The target can be a whole card that holds the menu's own dialogs: events from those, or
  // from anything portalled out of it, keep their native behaviour.
  const fromTarget = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target)) return false;
    const dialog = target.closest('dialog');
    return !dialog || dialog.contains(event.currentTarget);
  };
  // A card itself takes no focus: return it to the link under the event, else to the ⋯ button.
  const focusFor = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) =>
    (event.target as Element).closest<HTMLElement>('a[href], button') ??
    (event.currentTarget.matches('a[href], button, [tabindex]') ? event.currentTarget : null) ??
    triggerRef.current;
  const targetProps = enabled
    ? {
        onContextMenu: (event: MouseEvent<HTMLElement>) => {
          if (!fromTarget(event)) return;
          event.preventDefault();
          open(event.currentTarget, focusFor(event), event.clientX, event.clientY);
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (!fromTarget(event)) return;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            open(event.currentTarget, focusFor(event));
          }
        },
      }
    : {};
  const trigger = (className: string) =>
    enabled && (
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={t('appearance.options', { name: project.name })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(event) => (menu ? close() : open(event.currentTarget, event.currentTarget))}
      >
        ⋯
      </button>
    );
  const layer = (
    <>
      {menu &&
        enabled &&
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
                const all = [
                  ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ) ?? []),
                ];
                const i = all.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? all.length - 1
                      : (i + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
                all[next]?.focus();
              }
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.action();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          opener.current?.closest('dialog') ?? document.body,
        )}
      {editing && (
        <ProjectAppearanceDialog
          project={project}
          onSaved={onSaved}
          onClose={() => {
            setEditing(false);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
  return { trigger, targetProps, layer };
}

/** A project in the sidebar, with its ⋯ menu. */
export function ProjectNavItem({
  project,
  active,
  onClick,
}: {
  project: Project;
  active: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { trigger, targetProps, layer } = useProjectMenu(project);
  return (
    <div className="project-navigation">
      <NavItem
        leading={<ProjectGlyph {...project.icon} />}
        label={project.name}
        href={`/p/${project.id}`}
        active={active}
        onClick={onClick}
        {...targetProps}
      />
      {trigger('project-navigation__options')}
      {layer}
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
