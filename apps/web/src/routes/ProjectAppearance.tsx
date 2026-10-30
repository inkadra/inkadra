/* biome-ignore-all lint/a11y/useSemanticElements: Custom radio tiles implement roving focus and arrow selection. */
import { defaultProjectIcon, type Project, ProjectIcon, type z } from '@inkadra/shared';
import { Button, Dialog, DialogActions, NavItem, ProjectGlyph, TextField } from '@inkadra/ui';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { canExportProject, ExportProjectDialog } from './ProjectTransfer.tsx';
import { updateProjectAppearance } from './projects.ts';
import './project-appearance.css';

/** Swatches in hue order, neutral last; the contract lists colours in the order they were added. */
export const COLOR_ORDER = [
  'blue',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'neutral',
] as const satisfies readonly z.infer<typeof ProjectIcon>['color'][];

type Appearance = z.infer<typeof ProjectIcon>;
export const canEditProjectAppearance = (project: Pick<Project, 'myRole'>) =>
  project.myRole === 'owner' || project.myRole === 'editor';

export interface ProjectMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  /** Goes after Export project…, at the end of the menu (Archive). */
  trailing?: boolean;
}

/**
 * The ⋯ menu of a project, shared by the sidebar and the Projects page: project appearance
 * for editors, then the caller's own actions, then Export project… for owners and editors. Returns the trigger, the right-click handlers
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
  const [exporting, setExporting] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items: ProjectMenuItem[] = [
    ...(canEditProjectAppearance(project)
      ? [{ label: t('appearance.title'), action: () => setEditing(true) }]
      : []),
    ...extra.filter((item) => !item.trailing),
    ...(canExportProject(project)
      ? [{ label: t('transfer.exportMenu'), action: () => setExporting(true) }]
      : []),
    ...extra.filter((item) => item.trailing),
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
      {exporting && (
        <ExportProjectDialog
          project={project}
          onClose={() => {
            setExporting(false);
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
  const [tab, setTab] = useState<'symbol' | 'emoji'>(project.icon.emoji ? 'emoji' : 'symbol');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const allowed = canEditProjectAppearance(project);
  useEffect(() => {
    document
      .querySelector<HTMLElement>('.project-appearance [role="tab"][aria-selected="true"]')
      ?.focus();
  }, []);
  const disabled = busy || !allowed;
  const payload = { ...icon, emoji: tab === 'symbol' ? null : icon.emoji };
  const valid = ProjectIcon.safeParse(payload).success && (tab !== 'emoji' || !!icon.emoji?.trim());
  async function save() {
    if (!allowed || !valid || busy) return;
    setBusy(true);
    setError(false);
    try {
      const updated = await updateProjectAppearance(project.id, payload);
      onSaved?.(updated);
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="phone-sheet project-appearance">
      <Dialog
        open
        title={t('appearance.title')}
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
          <button
            type="button"
            className="project-appearance__close"
            aria-label={t('appearance.close')}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
          <div
            className="project-appearance__preview"
            style={
              {
                '--project-bg':
                  icon.color === 'neutral'
                    ? 'var(--ink-surface-1)'
                    : `var(--ink-tag-${icon.color}-bg)`,
              } as CSSProperties
            }
          >
            <div className="project-appearance__tile">
              <ProjectGlyph {...icon} />
            </div>
            <div>
              <strong>{project.name}</strong>
              <div className="ink-muted">{t('appearance.sidebarPreview')}</div>
              <div className="project-appearance__sidebar">
                <ProjectGlyph {...icon} />
                {project.name}
              </div>
            </div>
          </div>
          <div
            className="project-appearance__tabs"
            role="tablist"
            aria-label={t('appearance.title')}
          >
            {(['symbol', 'emoji'] as const).map((value) => (
              <button
                type="button"
                key={value}
                role="tab"
                id={`appearance-tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`appearance-panel-${value}`}
                tabIndex={tab === value ? 0 : -1}
                disabled={disabled}
                onClick={() => {
                  setTab(value);
                }}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 'symbol'
                        : event.key === 'End'
                          ? 'emoji'
                          : value === 'symbol'
                            ? 'emoji'
                            : 'symbol';
                    setTab(next);

                    document.getElementById(`appearance-tab-${next}`)?.focus();
                  }
                }}
              >
                {t(`appearance.${value}`)}
              </button>
            ))}
          </div>
          <div className="project-appearance__panels">
            <div
              role="tabpanel"
              inert={tab !== 'symbol'}
              id="appearance-panel-symbol"
              aria-labelledby="appearance-tab-symbol"
              hidden={tab !== 'symbol'}
            >
              <div
                className="project-appearance__choices"
                role="radiogroup"
                aria-label={t('appearance.symbol')}
                onKeyDown={radioKeys}
              >
                {ProjectIcon.shape.shape.options.map((shape) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={icon.shape === shape}
                    tabIndex={icon.shape === shape ? 0 : -1}
                    disabled={disabled}
                    key={shape}
                    onClick={() => setIcon({ ...icon, shape })}
                  >
                    <ProjectGlyph shape={shape} color={icon.color} />
                    <span>{t(`appearance.shapes.${shape}`)}</span>
                  </button>
                ))}
              </div>
              <div className="project-appearance__color-label">
                {t('appearance.color')} · {t(`appearance.colors.${icon.color}`)}
              </div>
              <div
                className="project-appearance__swatches"
                role="radiogroup"
                aria-label={t('appearance.color')}
                onKeyDown={radioKeys}
              >
                {COLOR_ORDER.map((color) => (
                  <button
                    type="button"
                    role="radio"
                    aria-label={t(`appearance.colors.${color}`)}
                    aria-checked={icon.color === color}
                    tabIndex={icon.color === color ? 0 : -1}
                    disabled={disabled}
                    key={color}
                    style={
                      {
                        '--swatch':
                          color === 'neutral' ? 'var(--ink-text-muted)' : `var(--ink-tag-${color})`,
                      } as CSSProperties
                    }
                    onClick={() => setIcon({ ...icon, color })}
                  />
                ))}
              </div>
            </div>
            {/* The Symbol panel sets the height; the emoji grid scrolls inside it. */}
            <div
              role="tabpanel"
              className="project-appearance__emoji-panel"
              inert={tab !== 'emoji'}
              id="appearance-panel-emoji"
              aria-labelledby="appearance-tab-emoji"
              hidden={tab !== 'emoji'}
            >
              <div
                className="project-appearance__emojis"
                role="radiogroup"
                aria-label={t('appearance.emoji')}
                onKeyDown={radioKeys}
              >
                {[
                  '🎬',
                  '🎥',
                  '📷',
                  '🎞️',
                  '🎭',
                  '🎨',
                  '💡',
                  '🎙️',
                  '🌆',
                  '🏔️',
                  '🌊',
                  '🚗',
                  '👗',
                  '🍝',
                  '⭐',
                  '🔥',
                ].map((emoji, index, all) => (
                  <button
                    type="button"
                    role="radio"
                    aria-label={emoji}
                    aria-checked={icon.emoji === emoji}
                    tabIndex={
                      icon.emoji === emoji || (!all.includes(icon.emoji ?? '') && index === 0)
                        ? 0
                        : -1
                    }
                    disabled={disabled}
                    key={emoji}
                    onClick={() => setIcon({ ...icon, emoji })}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <TextField
                label={t('appearance.pasteEmoji')}
                disabled={disabled}
                value={icon.emoji ?? ''}
                maxLength={32}
                placeholder="🎬"
                onChange={(event) => setIcon({ ...icon, emoji: event.target.value || null })}
              />
              <p className="ink-muted">{t('appearance.emojiHelp')}</p>
            </div>
          </div>
          <div className="project-appearance__feedback">
            {tab === 'emoji' && !icon.emoji?.trim() && (
              <p className="ink-muted">{t('appearance.chooseEmoji')}</p>
            )}
            {tab === 'emoji' && !!icon.emoji?.trim() && !valid && (
              <p role="alert">{t('appearance.invalid')}</p>
            )}
          </div>
          {error && <p role="alert">{t('appearance.error')}</p>}
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              className="project-appearance__reset"
              disabled={disabled}
              onClick={() => {
                setIcon(defaultProjectIcon(project.id));
                setTab('symbol');
              }}
            >
              {t('appearance.reset')}
            </Button>
            <Button type="button" disabled={busy} onClick={onClose}>
              {t('project.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !allowed || !valid}>
              {t('settings.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  );
}

/** Roving focus and selection for every tile/swatches group. */
function radioKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
    return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  ];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + items.length) %
          items.length;
  items[next]?.focus();
  items[next]?.click();
}
