/* biome-ignore-all lint/a11y/useSemanticElements: Custom radio swatches implement roving focus and arrow selection. */
import { type Project, type ProjectGroup, ProjectGroupColor } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon, NavItem, Select, TextField } from '@inkadra/ui';
import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../lib/phone.ts';
import { radioKeys, useMenu } from './ProjectAppearance.tsx';
import {
  createGroup,
  dissolveGroup,
  GROUP_DRAG,
  moveToGroup,
  PROJECT_DRAG,
  setDragging,
  setDragOver,
  updateGroup,
  useDragOver,
} from './project-groups.ts';
import './project-groups.css';

export const groupColor = (color: ProjectGroup['color']) => `var(--ink-tag-${color})`;

/** The colour of a group, beside its name. */
export function GroupDot({ color }: { color: ProjectGroup['color'] }) {
  return (
    <span
      aria-hidden="true"
      className="project-group-dot"
      style={{ '--group': groupColor(color) } as CSSProperties}
    />
  );
}

/** New group, or renaming one: a name and one of six colours. */
export function ProjectGroupDialog({
  group,
  onClose,
}: {
  group?: ProjectGroup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState<ProjectGroup['color']>(group?.color ?? 'blue');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(false);
    try {
      if (group) await updateGroup(group.id, { name: name.trim(), color });
      else await createGroup({ name: name.trim(), color });
      onClose();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={t(group ? 'groups.rename' : 'groups.new')}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form className="settings__form project-group-dialog" onSubmit={submit}>
        <TextField
          label={t('groups.name')}
          value={name}
          maxLength={80}
          required
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <div
          className="project-appearance__swatches project-group-dialog__swatches"
          role="radiogroup"
          aria-label={t('groups.color')}
          onKeyDown={radioKeys}
        >
          {ProjectGroupColor.options.map((c) => (
            <button
              type="button"
              role="radio"
              key={c}
              aria-label={t(`appearance.colors.${c}`)}
              aria-checked={color === c}
              tabIndex={color === c ? 0 : -1}
              disabled={busy}
              style={{ '--swatch': groupColor(c) } as CSSProperties}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <p className="ink-muted project-group-dialog__note">{t('groups.personal')}</p>
        {error && <p role="alert">{t('projectsPage.saveError')}</p>}
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {t(group ? 'settings.save' : 'groups.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Move to group…: the way on a phone, and by keyboard, where there is no dragging. */
export function MoveToGroupDialog({
  project,
  groups,
  onClose,
  onMoved,
}: {
  project: Project;
  groups: ProjectGroup[];
  onClose: () => void;
  onMoved?: (project: Project) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(project.group?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      onMoved?.(await moveToGroup(project.id, target || null));
      onClose();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`${t('groups.moveTo')} · ${project.name}`}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form className="settings__form" onSubmit={submit}>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
        <label className="project-type-field">
          {t('groups.group')}
          <Select className="ink-input" value={target} disabled={busy} onChange={setTarget}>
            <option value="">{t('groups.none')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </label>
        {error && <p role="alert">{t('projectsPage.saveError')}</p>}
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('groups.move')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** The ⋯ and right-click menu of a group: rename, colour, new project in it, dissolve. */
export function useGroupMenu(group: ProjectGroup, onNewProject?: () => void) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [failed, setFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (work: Promise<unknown>) => {
    setFailed(false);
    work.catch(() => setFailed(true));
  };
  const { open, close, isOpen, opener, layer } = useMenu(group.name, [
    { label: t('groups.rename'), action: () => setRenaming(true) },
    ...ProjectGroupColor.options.map((color) => ({
      label: t(`appearance.colors.${color}`),
      swatch: {
        color: groupColor(color),
        checked: group.color === color,
        group: t('groups.color'),
      },
      action: () => run(updateGroup(group.id, { color })),
    })),
    ...(onNewProject ? [{ label: t('groups.newProject'), action: onNewProject }] : []),
    { label: t('groups.dissolve'), danger: true, action: () => run(dissolveGroup(group.id)) },
  ]);
  const trigger = (className: string) => (
    <button
      ref={triggerRef}
      type="button"
      className={className}
      aria-label={t('groups.options', { name: group.name })}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onClick={(event) => (isOpen ? close() : open(event.currentTarget, event.currentTarget))}
    >
      ⋯
    </button>
  );
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    open(event.currentTarget, triggerRef.current, event.clientX, event.clientY);
  };
  return {
    trigger,
    onContextMenu,
    layer: (
      <>
        {layer}
        {failed && (
          <p role="alert" className="ink-sr-only">
            {t('projectsPage.saveError')}
          </p>
        )}
        {renaming && (
          <ProjectGroupDialog
            group={group}
            onClose={() => {
              setRenaming(false);
              opener.current?.focus();
            }}
          />
        )}
      </>
    ),
  };
}

/** A project that can be dragged into a group; phones use Move to group… instead. */
export function useProjectDrag(project: Project) {
  const phone = useIsPhone();
  if (phone) return {};
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(PROJECT_DRAG, project.id);
      event.dataTransfer.effectAllowed = 'move';
      // After the browser took the drag image: the card then stays as a placeholder.
      requestAnimationFrame(() => setDragging(project.id));
    },
    onDragEnd: () => setDragging(null),
  };
}

/**
 * A place a dragged project (or group) can land: `target` is a group id or `loose`. The
 * drop receives the dragged id and whether the pointer was on the lower half, for "after".
 */
export function useDropTarget(
  target: string,
  drop: (id: string, after: boolean, kind: 'project' | 'group') => void,
  accepts: ('project' | 'group')[] = ['project'],
) {
  const over = useDragOver();
  const kindOf = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.types.includes(PROJECT_DRAG) && accepts.includes('project')
      ? 'project'
      : event.dataTransfer.types.includes(GROUP_DRAG) && accepts.includes('group')
        ? 'group'
        : null;
  return {
    isOver: over === target,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!kindOf(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setDragOver(target);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && over === target)
          setDragOver(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const kind = kindOf(event);
        if (!kind) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const id = event.dataTransfer.getData(kind === 'project' ? PROJECT_DRAG : GROUP_DRAG);
        setDragging(null);
        if (id) drop(id, event.clientY > rect.top + rect.height / 2, kind);
      },
    },
  };
}

/** The chevron of a foldable group: points right when folded, down when open. */
export const GroupChevron = () => (
  <Icon name="chevronRight" size={12} className="ink-icon project-group-chevron" />
);

/** Where a group dropped on `target` goes: before it, or before the one after it. */
export function reorderGroup(groups: ProjectGroup[], id: string, target: string, after: boolean) {
  if (id === target) return;
  const others = groups.filter((g) => g.id !== id);
  const at = others.findIndex((g) => g.id === target) + (after ? 1 : 0);
  void updateGroup(id, { before: others[at]?.id ?? null }).catch(() => {});
}

/** A group in the sidebar: its row folds and unfolds it and takes dropped projects. */
export function SidebarGroup({
  group,
  groups,
  count,
  onNewProject,
  children,
}: {
  group: ProjectGroup;
  groups: ProjectGroup[];
  count: number;
  onNewProject?: () => void;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  const { trigger, onContextMenu, layer } = useGroupMenu(group, onNewProject);
  const drop = useDropTarget(
    group.id,
    (id, after, kind) =>
      kind === 'group'
        ? reorderGroup(groups, id, group.id, after)
        : void moveToGroup(id, group.id).catch(() => {}),
    ['project', 'group'],
  );
  return (
    <div className="project-group-nav">
      <div className={`project-navigation${drop.isOver ? ' is-drop' : ''}`} {...drop.props}>
        <NavItem
          leading={
            <>
              <GroupChevron />
              <GroupDot color={group.color} />
            </>
          }
          label={group.name}
          count={count}
          aria-expanded={!group.collapsed}
          onContextMenu={onContextMenu}
          onClick={() =>
            void updateGroup(group.id, { collapsed: !group.collapsed }).catch(() => {})
          }
          {...(phone
            ? {}
            : {
                draggable: true,
                onDragStart: (event: DragEvent<HTMLElement>) => {
                  event.dataTransfer.setData(GROUP_DRAG, group.id);
                  event.dataTransfer.effectAllowed = 'move';
                },
                onDragEnd: () => setDragging(null),
              })}
        />
        {trigger('project-navigation__options')}
      </div>
      <div className="project-group-nav__items">{children}</div>
      {layer}
    </div>
  );
}
