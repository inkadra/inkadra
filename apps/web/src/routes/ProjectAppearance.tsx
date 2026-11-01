/* biome-ignore-all lint/a11y/useSemanticElements: Custom radio tiles implement roving focus and arrow selection. */
import {
  DEFAULT_PROJECT_THEME,
  defaultProjectIcon,
  type ExportSettings,
  type Project,
  ProjectIcon,
  type ProjectTheme,
  THEME_FONTS,
  type ThemeFont,
  type z,
} from '@inkadra/shared';
import {
  Button,
  Dialog,
  DialogActions,
  type DialogHandle,
  NavItem,
  ProjectGlyph,
  swallowOutsidePress,
} from '@inkadra/ui';
import { light } from '@inkadra/ui/tokens';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  fetchExportSettings,
  LogoTimeoutError,
  logoProblem,
  logoUrl,
  saveExportSettings,
  uploadLogo,
} from '../board/export/settings.ts';
import { headingFamily, loadHeadingFont, paperAccent, screenAccent } from '../board/theme.ts';
import { MoveToGroupDialog, useDropTarget, useProjectDrag } from './ProjectGroups.tsx';
import { canExportProject, ExportProjectDialog } from './ProjectTransfer.tsx';
import { useDragging, useProjectGroups } from './project-groups.ts';
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
  /** Destructive: set apart at the end, in the danger colour. */
  danger?: boolean;
  /** A colour choice: consecutive swatches share one row, after their `label` heading. */
  swatch?: { color: string; checked: boolean; group: string };
}

/**
 * A ⋯ / right-click menu: opens at an element or a point, moves focus in, closes on Escape,
 * Tab or a press outside, and gives focus back. Returns `open`, whether it is open, the
 * focus target to return to and the layer to render.
 */
export function useMenu(label: string, items: ProjectMenuItem[]) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setMenu(null);
    opener.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        menuRef.current?.contains(event.target as Node) ||
        opener.current?.contains(event.target as Node)
      )
        return;
      swallowOutsidePress(event);
      setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
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
  const choose = (item: ProjectMenuItem) => () => {
    close();
    item.action();
  };
  const button = (item: ProjectMenuItem) =>
    item.swatch ? (
      <button
        key={item.label}
        type="button"
        role="menuitemradio"
        aria-checked={item.swatch.checked}
        aria-label={item.label}
        style={{ '--swatch': item.swatch.color } as CSSProperties}
        disabled={item.disabled}
        onClick={choose(item)}
      />
    ) : (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={item.danger ? 'is-danger' : undefined}
        disabled={item.disabled}
        onClick={choose(item)}
      >
        {item.label}
      </button>
    );
  const rows: ReactNode[] = [];
  items.forEach((item, i) => {
    const previous = items[i - 1];
    if (item.danger && !previous?.danger && i > 0)
      rows.push(<hr key={`sep-${item.label}`} className="project-context-menu__separator" />);
    if (!item.swatch) rows.push(button(item));
    else if (previous?.swatch?.group !== item.swatch.group) {
      const { group } = item.swatch;
      rows.push(
        <div key={`label-${group}`} className="project-context-menu__label" aria-hidden="true">
          {group}
        </div>,
        <div
          key={`row-${group}`}
          role="group"
          aria-label={group}
          className="project-context-menu__swatches"
        >
          {items.filter((other) => other.swatch?.group === group).map(button)}
        </div>,
      );
    }
  });
  const layer =
    menu &&
    items.length > 0 &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className="project-context-menu"
        style={{ left: menu.x, top: menu.y }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
            }
            close();
          } else if (
            ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
          ) {
            event.preventDefault();
            const all = [
              ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role^="menuitem"]:not(:disabled)',
              ) ?? []),
            ];
            const i = all.indexOf(document.activeElement as HTMLButtonElement);
            const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? all.length - 1
                  : (i + (forward ? 1 : -1) + all.length) % all.length;
            all[next]?.focus();
          }
        }}
      >
        {rows}
      </div>,
      opener.current?.closest('dialog') ?? document.body,
    );
  return { open, close, isOpen: !!menu, opener, layer };
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
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [moving, setMoving] = useState(false);
  const groups = useProjectGroups();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items: ProjectMenuItem[] = [
    ...(canEditProjectAppearance(project)
      ? [{ label: t('appearance.title'), action: () => setEditing(true) }]
      : []),
    // Personal, so for every member; on a phone it stands in for dragging (decision 0056).
    ...(groups.length > 0 || project.group
      ? [{ label: t('groups.moveTo'), action: () => setMoving(true) }]
      : []),
    ...extra.filter((item) => !item.trailing),
    ...(canExportProject(project)
      ? [{ label: t('transfer.exportMenu'), action: () => setExporting(true) }]
      : []),
    ...extra.filter((item) => item.trailing),
  ];
  const enabled = items.length > 0;
  const { open, close, isOpen, opener, layer: menuLayer } = useMenu(project.name, items);
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
        aria-expanded={isOpen}
        onClick={(event) => (isOpen ? close() : open(event.currentTarget, event.currentTarget))}
      >
        ⋯
      </button>
    );
  const layer = (
    <>
      {menuLayer}
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
      {moving && (
        <MoveToGroupDialog
          project={project}
          groups={groups}
          onMoved={onSaved}
          onClose={() => {
            setMoving(false);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
  return { trigger, targetProps, layer };
}

/** A project in the sidebar, with its ⋯ menu; it can be dragged into or within a group. */
export function ProjectNavItem({
  project,
  active,
  onClick,
  onDropProject,
}: {
  project: Project;
  active: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** A project dropped on this one, on its upper or lower half. */
  onDropProject?: (projectId: string, after: boolean) => void;
}) {
  const { trigger, targetProps, layer } = useProjectMenu(project);
  const drag = useProjectDrag(project);
  const drop = useDropTarget(`row:${project.id}`, (id, after) => {
    if (id !== project.id) onDropProject?.(id, after);
  });
  const dragging = useDragging() === project.id;
  return (
    <div
      className={`project-navigation${drop.isOver ? ' is-drop' : ''}${dragging ? ' is-dragging' : ''}`}
      {...(onDropProject ? drop.props : {})}
    >
      <NavItem
        leading={<ProjectGlyph {...project.icon} />}
        label={project.name}
        href={`/p/${project.id}`}
        active={active}
        onClick={onClick}
        {...targetProps}
        {...drag}
      />
      {trigger('project-navigation__options')}
      {layer}
    </div>
  );
}

/** The emoji grid: four rows of eight, the most common picks for a film project. */
export const PROJECT_EMOJIS = [
  '🎬',
  '🎥',
  '📽️',
  '🎞️',
  '📷',
  '🎭',
  '🎨',
  '💡',
  '🎙️',
  '🎧',
  '🌆',
  '⛰️',
  '🌊',
  '🚗',
  '👗',
  '🍝',
  '⭐',
  '🔥',
  '🌙',
  '☀️',
  '🌲',
  '🏠',
  '✈️',
  '🚲',
  '❤️',
  '🎵',
  '📚',
  '🧭',
  '🏁',
  '🎯',
  '🐶',
  '🌸',
];

type AppearanceTab = 'symbol' | 'emoji' | 'presentation';
/** Font names are names: never translated. */
const FONT_NAMES: Record<ThemeFont, string> = {
  inter: 'Inter',
  fraunces: 'Fraunces',
  'space-grotesk': 'Space Grotesk',
  'ibm-plex-mono': 'IBM Plex Mono',
};

export function ProjectAppearanceDialog({
  project,
  onClose,
  onSaved,
  board,
}: {
  project: Pick<Project, 'id' | 'name' | 'icon' | 'myRole'> & { rootBoardId?: string };
  onClose: () => void;
  onSaved?: (project: Project) => void;
  /**
   * Picks the icon of a board card instead (#322): saved through `save`, where null returns to
   * the default board icon.
   */
  board?: { save: (icon: Appearance | null) => Promise<unknown> };
}) {
  const { t } = useTranslation();
  const [icon, setIcon] = useState<Appearance>({ ...project.icon });
  const [tab, setTab] = useState<AppearanceTab>(project.icon.emoji ? 'emoji' : 'symbol');
  // Symbol or emoji, whichever was shown last: the Presentation tab keeps that choice.
  const [iconTab, setIconTab] = useState<'symbol' | 'emoji'>(tab === 'emoji' ? 'emoji' : 'symbol');
  const tabs: AppearanceTab[] = board ? ['symbol', 'emoji'] : ['symbol', 'emoji', 'presentation'];
  const showTab = (value: AppearanceTab) => {
    setTab(value);
    if (value !== 'presentation') setIconTab(value);
  };
  // What is typed in the field: an emoji from the grid shows as a choice there, not as text.
  const [typed, setTyped] = useState(
    project.icon.emoji && !PROJECT_EMOJIS.includes(project.icon.emoji) ? project.icon.emoji : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // The presentation and PDF theme lives with the export settings, like the logo (decision 0057).
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [theme, setTheme] = useState<ProjectTheme>(DEFAULT_PROJECT_THEME);
  const [logoState, setLogoState] = useState<
    'idle' | 'busy' | 'type' | 'size' | 'failed' | 'timeout'
  >('idle');
  const fileInput = useRef<HTMLInputElement>(null);
  const allowed = canEditProjectAppearance(project);
  const dialog = useRef<DialogHandle>(null);
  useEffect(() => {
    document
      .querySelector<HTMLElement>('.project-appearance [role="tab"][aria-selected="true"]')
      ?.focus();
  }, []);
  useEffect(() => {
    if (board) return;
    let live = true;
    fetchExportSettings(project.id).then(
      (loaded) => {
        if (!live) return;
        setSettings(loaded);
        // A server older than the theme answers without it.
        setTheme(loaded.theme ?? DEFAULT_PROJECT_THEME);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [board, project.id]);
  useEffect(() => {
    // The font list and previews show every heading font in its own face.
    if (tab === 'presentation') for (const font of THEME_FONTS) void loadHeadingFont(font);
  }, [tab]);
  const disabled = busy || !allowed;
  const themeDisabled = disabled || !settings?.canEdit;
  const payload = { ...icon, emoji: iconTab === 'symbol' ? null : icon.emoji };
  const valid =
    ProjectIcon.safeParse(payload).success && (iconTab !== 'emoji' || !!icon.emoji?.trim());
  const saved = settings?.theme ?? DEFAULT_PROJECT_THEME;
  const themeDirty =
    !!settings && (theme.accent !== saved.accent || theme.headingFont !== saved.headingFont);
  const dirty =
    allowed &&
    !busy &&
    (themeDirty ||
      payload.shape !== project.icon.shape ||
      payload.color !== project.icon.color ||
      (payload.emoji ?? null) !== (project.icon.emoji ?? null));
  async function save(reset = false) {
    if (!allowed || (!valid && !reset) || busy) return;
    setBusy(true);
    setError(false);
    try {
      if (board) await board.save(reset ? null : payload);
      else {
        if (themeDirty) await saveExportSettings(project.id, { theme });
        const updated = await updateProjectAppearance(project.id, payload);
        onSaved?.(updated);
      }
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  // The logo is saved at once, as in the export dialog: it is shared with every export.
  async function pickLogo(file: File | undefined) {
    if (!file || !project.rootBoardId) return;
    const problem = logoProblem(file);
    if (problem) {
      setLogoState(problem);
      return;
    }
    setLogoState('busy');
    try {
      const assetId = await uploadLogo(file, project.id, project.rootBoardId);
      setSettings(await saveExportSettings(project.id, { logoAssetId: assetId }));
      setLogoState('idle');
    } catch (err) {
      setLogoState(err instanceof LogoTimeoutError ? 'timeout' : 'failed');
    }
  }
  async function dropLogo() {
    setLogoState('busy');
    try {
      setSettings(await saveExportSettings(project.id, { logoAssetId: null }));
      setLogoState('idle');
    } catch {
      setLogoState('failed');
    }
  }
  const shown = { ...icon, emoji: iconTab === 'symbol' ? null : icon.emoji };
  const accent = theme.accent ?? icon.color;
  const logo = settings?.logo ?? null;
  const logoError = ['type', 'size', 'failed', 'timeout'].includes(logoState);
  const themeStyle = {
    '--theme-accent': screenAccent(accent),
    '--theme-heading': headingFamily(theme.headingFont),
    '--paper-accent': paperAccent(accent),
    '--paper-bg': light['surface-1'],
    '--paper-text': light['text-primary'],
    '--paper-muted': light['text-secondary'],
    '--paper-line': light['border-default'],
  } as CSSProperties;
  return (
    <div
      className={`phone-sheet project-appearance${tab === 'presentation' ? ' project-appearance--theme' : ''}`}
    >
      <Dialog
        ref={dialog}
        open
        dirty={dirty}
        title={t(board ? 'appearance.boardTitle' : 'appearance.title')}
        onClose={onClose}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          className="project-appearance__form"
          style={themeStyle}
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
            onClick={() => dialog.current?.requestClose()}
          >
            ×
          </button>
          {tab !== 'presentation' && (
            <div className="project-appearance__preview">
              <div
                className="project-appearance__tile"
                style={
                  {
                    '--project-bg':
                      shown.emoji || icon.color === 'neutral'
                        ? 'var(--ink-surface-3)'
                        : `var(--ink-tag-${icon.color}-bg)`,
                  } as CSSProperties
                }
              >
                <ProjectGlyph {...shown} />
              </div>
              <div className="project-appearance__name">
                <strong>{project.name}</strong>
                <small>{t(board ? 'appearance.boardPreview' : 'appearance.sidebarPreview')}</small>
              </div>
            </div>
          )}
          <div
            className="project-appearance__tabs"
            role="tablist"
            aria-label={t('appearance.title')}
          >
            {tabs.map((value, index) => (
              <button
                type="button"
                key={value}
                role="tab"
                id={`appearance-tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`appearance-panel-${value}`}
                tabIndex={tab === value ? 0 : -1}
                disabled={disabled}
                onClick={() => showTab(value)}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const step = event.key === 'ArrowLeft' ? -1 : 1;
                    const next =
                      event.key === 'Home'
                        ? tabs[0]
                        : event.key === 'End'
                          ? tabs.at(-1)
                          : tabs[(index + step + tabs.length) % tabs.length];
                    if (!next) return;
                    showTab(next);
                    document.getElementById(`appearance-tab-${next}`)?.focus();
                  }
                }}
              >
                {t(value === 'presentation' ? 'appearance.presentation' : `appearance.${value}`)}
              </button>
            ))}
          </div>
          {/* Symbol and Emoji share one fixed height: switching between them never resizes. */}
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
                    aria-label={t(`appearance.shapes.${shape}`)}
                    title={t(`appearance.shapes.${shape}`)}
                    aria-checked={icon.shape === shape}
                    tabIndex={icon.shape === shape ? 0 : -1}
                    disabled={disabled}
                    key={shape}
                    onClick={() => setIcon({ ...icon, shape })}
                  >
                    <ProjectGlyph shape={shape} color={icon.color} />
                  </button>
                ))}
              </div>
              <div className="project-appearance__color-label">
                <span>{t('appearance.color')}</span>
                <span>{t(`appearance.colors.${icon.color}`)}</span>
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
                    style={{ '--swatch': screenAccent(color) } as CSSProperties}
                    onClick={() => setIcon({ ...icon, color })}
                  />
                ))}
              </div>
            </div>
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
                {PROJECT_EMOJIS.map((emoji, index) => (
                  <button
                    type="button"
                    role="radio"
                    aria-label={emoji}
                    aria-checked={icon.emoji === emoji}
                    tabIndex={
                      icon.emoji === emoji ||
                      (!PROJECT_EMOJIS.includes(icon.emoji ?? '') && index === 0)
                        ? 0
                        : -1
                    }
                    disabled={disabled}
                    key={emoji}
                    onClick={() => {
                      setIcon({ ...icon, emoji });
                      setTyped('');
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <label className="project-appearance__custom">
                <span aria-hidden="true" className="project-appearance__custom-glyph">
                  {icon.emoji || '·'}
                </span>
                <input
                  className="project-appearance__custom-input"
                  aria-label={t('appearance.pasteEmoji')}
                  placeholder={t('appearance.pasteEmoji')}
                  disabled={disabled}
                  value={typed}
                  maxLength={32}
                  autoComplete="off"
                  onChange={(event) => {
                    const value = event.target.value;
                    setTyped(value);
                    setIcon({ ...icon, emoji: value.trim() || null });
                  }}
                />
              </label>
            </div>
            {/* Outside the tab panels, on a line kept free for it: showing it moves nothing. */}
            {tab === 'emoji' && !!icon.emoji?.trim() && !valid && (
              <p className="project-appearance__message project-appearance__invalid" role="alert">
                {t('appearance.invalid')}
              </p>
            )}
            {!board && (
              <div
                role="tabpanel"
                className="project-appearance__theme"
                inert={tab !== 'presentation'}
                id="appearance-panel-presentation"
                aria-labelledby="appearance-tab-presentation"
                hidden={tab !== 'presentation'}
              >
                <div className="project-appearance__color-label">
                  <span>{t('appearance.theme.accent')}</span>
                  <span>
                    {theme.accent
                      ? t(`appearance.colors.${accent}`)
                      : t('appearance.theme.accentDefault', {
                          color: t(`appearance.colors.${accent}`),
                        })}
                  </span>
                </div>
                <div
                  className="project-appearance__swatches"
                  role="radiogroup"
                  aria-label={t('appearance.theme.accent')}
                  onKeyDown={radioKeys}
                >
                  {COLOR_ORDER.map((color) => (
                    <button
                      type="button"
                      role="radio"
                      aria-label={t(`appearance.colors.${color}`)}
                      aria-checked={accent === color}
                      tabIndex={accent === color ? 0 : -1}
                      disabled={themeDisabled}
                      key={color}
                      style={{ '--swatch': screenAccent(color) } as CSSProperties}
                      // The project's own colour is stored as "follow the project".
                      onClick={() =>
                        setTheme({ ...theme, accent: color === icon.color ? null : color })
                      }
                    />
                  ))}
                </div>
                <div className="project-appearance__color-label">
                  <span>{t('appearance.theme.font')}</span>
                  <span>{t('appearance.theme.fontNote')}</span>
                </div>
                <div
                  className="project-appearance__fonts"
                  role="radiogroup"
                  aria-label={t('appearance.theme.font')}
                  onKeyDown={radioKeys}
                >
                  {THEME_FONTS.map((font) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={theme.headingFont === font}
                      tabIndex={theme.headingFont === font ? 0 : -1}
                      disabled={themeDisabled}
                      key={font}
                      style={{ fontFamily: headingFamily(font) }}
                      onClick={() => setTheme({ ...theme, headingFont: font })}
                    >
                      {FONT_NAMES[font]}
                      <small>{t(`appearance.theme.fonts.${font}`)}</small>
                    </button>
                  ))}
                </div>
                <div className="project-appearance__color-label">
                  <span>{t('appearance.theme.logo')}</span>
                  <span>{t('appearance.theme.logoNote')}</span>
                </div>
                <div className="project-appearance__logo">
                  <span className="project-appearance__logo-image">
                    {logo && <img src={logoUrl(logo)} alt="" />}
                  </span>
                  <span className="project-appearance__logo-text">
                    <strong>{logo ? logo.filename : t('appearance.theme.noLogo')}</strong>
                    <small
                      role={logoError ? 'alert' : 'status'}
                      className={logoError ? 'is-error' : undefined}
                    >
                      {logoState === 'busy'
                        ? t('export.logoUploading')
                        : logoState === 'type' || logoState === 'size'
                          ? t('export.logoInvalid')
                          : logoState === 'failed'
                            ? t('export.logoFailed')
                            : logoState === 'timeout'
                              ? t('export.logoTimeout')
                              : t('appearance.theme.logoUse')}
                    </small>
                  </span>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="ink-sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                      void pickLogo(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    disabled={themeDisabled || logoState === 'busy' || !project.rootBoardId}
                    onClick={() => fileInput.current?.click()}
                  >
                    {logo ? t('export.logoReplace') : t('export.logoAdd')}
                  </Button>
                  {logo && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={themeDisabled || logoState === 'busy'}
                      onClick={() => void dropLogo()}
                    >
                      {t('appearance.theme.logoRemove')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          {tab === 'presentation' && (
            <div className="project-appearance__previews" aria-hidden="true">
              <span className="project-appearance__preview-label">
                {t('appearance.theme.previewSlide')}
              </span>
              <div className="project-appearance__slide">
                <span className="project-appearance__slide-head">
                  {logo && <img src={logoUrl(logo)} alt="" />}
                  {project.name}
                </span>
                <span className="project-appearance__slide-title">
                  {t('appearance.theme.sampleTitle')}
                </span>
                <span className="project-appearance__slide-meta">
                  {t('appearance.theme.sampleMeta')}
                </span>
                <span className="project-appearance__slide-picture" />
              </div>
              <span className="project-appearance__preview-label">
                {t('appearance.theme.previewPdf')}
              </span>
              <div className="project-appearance__pages">
                <div className="project-appearance__page">
                  {logo && <img src={logoUrl(logo)} alt="" />}
                  <span className="project-appearance__page-title">{project.name}</span>
                  <span className="project-appearance__page-meta">
                    {t('film.views.storyboard')}
                  </span>
                  <span className="project-appearance__page-bar" />
                </div>
                <div className="project-appearance__page">
                  <span className="project-appearance__page-header">
                    <span>{t('film.views.shotlist')}</span>
                    {logo && <img src={logoUrl(logo)} alt="" />}
                  </span>
                  {[100, 80, 100, 70, 100, 85].map((width, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines.
                    <i key={i} style={{ width: `${width}%` }} />
                  ))}
                  <span className="project-appearance__page-number">
                    {t('export.pageOf', { n: 2, total: 9 })}
                  </span>
                </div>
              </div>
              <small>{t('appearance.theme.paperNote')}</small>
            </div>
          )}
          {error && (
            <p className="project-appearance__message" role="alert">
              {t('appearance.error')}
            </p>
          )}
          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              className="project-appearance__reset"
              disabled={tab === 'presentation' ? themeDisabled : disabled}
              onClick={() => {
                if (tab === 'presentation') {
                  setTheme(DEFAULT_PROJECT_THEME);
                  return;
                }
                if (board) {
                  void save(true);
                  return;
                }
                setIcon(defaultProjectIcon(project.id));
                setTyped('');
                showTab('symbol');
              }}
            >
              {t('appearance.reset')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => dialog.current?.requestClose()}
            >
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
export function radioKeys(event: KeyboardEvent<HTMLDivElement>) {
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
