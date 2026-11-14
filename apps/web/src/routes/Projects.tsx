import type { Project, ProjectGroup } from '@inkadra/shared';
import {
  Avatar,
  Button,
  CoverCard,
  Dialog,
  DialogActions,
  Icon,
  IconButton,
  ProjectGlyph,
  Select,
} from '@inkadra/ui';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { useIsPhone } from '../lib/phone.ts';
import { usePreferences } from '../lib/preferences.ts';
import { useSession } from '../lib/session.tsx';
import { relativeTime } from '../notifications/Notifications.tsx';
import { useProjects } from './AppLayout.tsx';
import { addBoardItems } from './add-storyboard.ts';
import { BoardPreview } from './BoardPreview.tsx';
import { useProjectMenu } from './ProjectAppearance.tsx';
import {
  GroupChevron,
  GroupDot,
  GroupSaveError,
  ProjectGroupDialog,
  useDropTarget,
  useGroupMenu,
  useProjectDrag,
} from './ProjectGroups.tsx';
import {
  groupProjects,
  moveToGroup,
  reportGroupError,
  updateGroup,
  useDragging,
  useProjectGroups,
} from './project-groups.ts';
import { getCachedProjects, refreshProjects, subscribeProjects } from './projects.ts';
import {
  archivedProjects,
  filterProjects,
  type ProjectOverview,
  projectOverviews,
} from './projects-overview.ts';
import { formatStorage } from './StorageCharts.tsx';
import './home.css';
import './projects.css';
import { formatDateTime } from '../lib/datetime.ts';

export function Projects() {
  const { catalogs, typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { openNewProject, openImportProject, canCreateProjects } = useProjects();
  // The sidebar says when a group change was not saved; on a phone it is out of sight.
  const phone = useIsPhone();
  const [items, setItems] = useState<ProjectOverview[] | null>(null);
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    known.current = new Set(items?.map((row) => row.project.id));
  }, [items]);
  useEffect(
    () =>
      subscribeProjects(() => {
        const cached = getCachedProjects();
        // A project created elsewhere (an import that just finished) needs its overview.
        if (cached?.some((p) => !known.current.has(p.id))) void loadRef.current();
        else if (cached)
          setItems(
            (current) =>
              current?.map((row) => ({
                ...row,
                project: cached.find((p) => p.id === row.project.id) ?? row.project,
              })) ?? null,
          );
      }),
    [],
  );
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [view, setView] = useState('grid');
  const groups = useProjectGroups();
  const [newGroup, setNewGroup] = useState(false);
  const [query, setQuery] = useState({
    search: '',
    status: 'all',
    type: 'all',
    person: 'all',
    sort: 'activity',
  });
  const load = useCallback(async () => {
    setError(false);
    try {
      const [active, archived] = await Promise.all([refreshProjects(), archivedProjects()]);
      const result = await projectOverviews([...active, ...archived]);
      setItems(result);
    } catch {
      setError(true);
    }
  }, []);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let alive = true;
    api
      .get<{ originalBytes: number }>('/instance/storage')
      .then((body) => {
        if (alive) setUsage(body.originalBytes);
      })
      .catch(() => {
        if (alive) setUsageError(true);
      });
    return () => {
      alive = false;
    };
  }, [user?.role]);
  const replace = (updated: Project) =>
    setItems(
      (current) =>
        current?.map((row) =>
          row.project.id === updated.id ? { ...row, project: updated } : row,
        ) ?? null,
    );
  /** Resolves to whether the change was saved. */
  async function mutate(project: Project, change: Change): Promise<boolean> {
    setBusy(true);
    setError(false);
    try {
      const updated =
        change === 'pin'
          ? await api.put<Project>(`/projects/${project.id}/pin`, { pinned: !project.pinned })
          : await api.patch<Project>(
              `/projects/${project.id}`,
              change === 'archive' ? { archived: !project.archivedAt } : change,
            );
      replace(updated);
      await refreshProjects();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const people = new Map(
    items?.flatMap((row) => row.members.map((m) => [m.user.id, m.user] as const)),
  );
  // Filtering by people means nothing while the person works alone.
  const others = [...people.keys()].some((id) => id !== user?.id);
  const visible = filterProjects(items ?? [], query);
  // The page's sort applies inside every group; the groups keep their own order.
  const grouped = groupProjects(visible, groups, (row) => row.project, true);
  const filtered =
    query.search.trim() !== '' ||
    query.status !== 'all' ||
    query.type !== 'all' ||
    query.person !== 'all';
  /** A project dropped on a group (or, with null, outside any) goes last there. */
  const drop = (groupId: string | null) => (projectId: string) => {
    setError(false);
    moveToGroup(projectId, groupId)
      .then(replace)
      .catch(() => setError(true));
  };
  const card = (row: ProjectOverview) => (
    <ProjectCard
      key={row.project.id}
      row={row}
      busy={busy}
      mutate={mutate}
      onAppearanceSaved={replace}
      onDeleted={() =>
        setItems((current) => current?.filter((r) => r.project.id !== row.project.id) ?? null)
      }
      onError={() => setError(true)}
    />
  );
  const storageNote =
    usage !== null ? t('projectsPage.storage', { bytes: formatStorage(usage, i18n.language) }) : '';
  const change = (key: keyof typeof query, value: string) =>
    setQuery((q) => ({ ...q, [key]: value }));
  return (
    <div className="projects-page">
      <header className="projects-page__head">
        <div>
          <h1>{t('nav.projects')}</h1>
          {items && (
            <p className="ink-muted">
              {t('projectsPage.counts', {
                active: items.filter((r) => !r.project.archivedAt).length,
                archived: items.filter((r) => r.project.archivedAt).length,
              })}
              {/* What the instance keeps, for the administrator: once known, in the same line. */}
              {user?.role === 'admin' && (usage !== null || usageError) && ' '}
              {user?.role === 'admin' && (usage !== null || usageError) && (
                <span
                  className="projects-page__storage"
                  title={usage !== null ? storageNote : undefined}
                >
                  {usage !== null
                    ? t('projectsPage.storageShort', { bytes: formatStorage(usage, i18n.language) })
                    : t('projectsPage.storageError')}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="projects-page__actions">
          {canCreateProjects ? (
            <>
              <Link className="ink-btn ink-btn--ghost" to="/onboarding">
                {t('onboarding.guidedSetup')}
              </Link>
              <Button variant="ghost" onClick={openImportProject}>
                {t('transfer.importMenu')}
              </Button>
            </>
          ) : (
            // Decision 0041: New project in the top bar is off; this says why. A screen reader
            // already hears it as that button's description.
            <span className="ink-muted projects-page__off" aria-hidden="true">
              {t('projectCreation.off')}
            </span>
          )}
          {/* Groups are personal: everyone sorts their own list (decision 0056). */}
          <Button onClick={() => setNewGroup(true)}>{t('groups.new')}</Button>
        </div>
      </header>
      <div className="projects-page__filters">
        <label className="projects-page__search">
          <Icon name="search" size={15} />
          <input
            className="ink-input"
            type="search"
            aria-label={t('projectsPage.search')}
            placeholder={t('projectsPage.search')}
            value={query.search}
            onChange={(e) => change('search', e.target.value)}
          />
        </label>
        <Select
          className="ink-input"
          prefix={t('projectsPage.status')}
          value={query.status}
          onChange={(e) => change('status', e)}
        >
          {['all', 'active', 'archived'].map((v) => (
            <option key={v} value={v}>
              {t(`projectsPage.${v}`)}
            </option>
          ))}
        </Select>
        <Select
          className="ink-input"
          prefix={t('onboarding.type')}
          value={query.type}
          onChange={(e) => change('type', e)}
        >
          <option value="all">{t('projectsPage.all')}</option>
          {catalogs.projectTypes.map(({ id: v }) => (
            <option key={v} value={v}>
              {typeLabel(v)}
            </option>
          ))}
        </Select>
        {others && (
          <Select
            className="ink-input"
            prefix={t('projectsPage.people')}
            value={query.person}
            onChange={(e) => change('person', e)}
          >
            <option value="all">{t('projectsPage.all')}</option>
            {[...people].map(([id, person]) => (
              <option key={id} value={id}>
                {person.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          className="ink-input projects-page__sort"
          prefix={t('projectsPage.sort')}
          value={query.sort}
          onChange={(e) => change('sort', e)}
        >
          {['activity', 'name', 'created'].map((v) => (
            <option key={v} value={v}>
              {t(`projectsPage.sorts.${v}`)}
            </option>
          ))}
        </Select>
        <div className="projects-page__view">
          {(['grid', 'list'] as const).map((v) => (
            <IconButton
              key={v}
              icon={v === 'grid' ? 'tiles' : 'list'}
              label={t(`projectsPage.${v}`)}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            />
          ))}
        </div>
      </div>
      {phone && <GroupSaveError />}
      {error && (
        <p role="alert">
          {t('home.loadError')}{' '}
          <Button onClick={() => void load()}>{t('projectsPage.retry')}</Button>
        </p>
      )}
      {!items && !error && <p role="status">{t('comments.loading')}</p>}
      {items && visible.length === 0 && (
        <div className="projects-page__empty">
          <h2>{t('projectsPage.empty')}</h2>
          <p className="ink-muted">
            {t(canCreateProjects ? 'projectsPage.emptyBody' : 'projectCreation.emptyBody')}
          </p>
        </div>
      )}
      <LooseProjects view={view} empty={grouped.loose.length === 0} onDrop={drop(null)}>
        {grouped.loose.map(card)}
      </LooseProjects>
      {items &&
        grouped.groups
          .filter(({ items: inside }) => !filtered || inside.length > 0)
          .map(({ group, items: inside }) => (
            <GroupSection
              key={group.id}
              group={group}
              count={inside.length}
              view={view}
              onDrop={drop(group.id)}
              onNewProject={canCreateProjects ? () => openNewProject(group.id) : undefined}
            >
              {inside.map(card)}
            </GroupSection>
          ))}
      {newGroup && <ProjectGroupDialog onClose={() => setNewGroup(false)} />}
    </div>
  );
}

type Change = 'pin' | 'archive' | { type: string | null; timeZone?: string | null };

/** The projects outside any group; one dropped here leaves its group. */
function LooseProjects({
  view,
  empty,
  onDrop,
  children,
}: {
  view: string;
  empty: boolean;
  onDrop: (projectId: string) => void;
  children: ReactNode;
}) {
  const target = useDropTarget('loose', onDrop);
  const dragging = useDragging();
  return (
    <div className={`projects-page__items projects-page__items--${view}`} {...target.props}>
      {children}
      {/* With every project in a group, the slot is the way out of them. */}
      {dragging && (target.isOver || empty) && (
        <div className="project-group-slot" aria-hidden="true" />
      )}
    </div>
  );
}

/** One group: a header that folds it and takes dropped projects, over its own grid or list. */
function GroupSection({
  group,
  count,
  view,
  onDrop,
  onNewProject,
  children,
}: {
  group: ProjectGroup;
  count: number;
  view: string;
  onDrop: (projectId: string) => void;
  onNewProject?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { trigger, onContextMenu, layer } = useGroupMenu(group, onNewProject);
  const target = useDropTarget(group.id, onDrop);
  const dragging = useDragging();
  const open = !group.collapsed;
  const body = `project-group-${group.id}`;
  return (
    <section className="project-group-section" aria-label={group.name} {...target.props}>
      <div className={`project-group-head${target.isOver ? ' is-drop' : ''}`}>
        <button
          type="button"
          className="project-group-head__toggle"
          onContextMenu={onContextMenu}
          aria-expanded={open}
          aria-controls={body}
          onClick={() => void updateGroup(group.id, { collapsed: open }).catch(reportGroupError)}
        >
          <GroupChevron />
          <GroupDot color={group.color} />
          {group.name}
        </button>
        <span className="project-group-head__count">{t('groups.count', { count })}</span>
        {trigger('project-navigation__options project-group-head__options')}
      </div>
      {open && (
        <div id={body} className={`projects-page__items projects-page__items--${view}`}>
          {children}
          {target.isOver && dragging && <div className="project-group-slot" aria-hidden="true" />}
        </div>
      )}
      {layer}
    </section>
  );
}

function ProjectCard({
  row,
  busy,
  mutate,
  onAppearanceSaved,
  onDeleted,
  onError,
}: {
  row: ProjectOverview;
  onError: () => void;
  onAppearanceSaved: (project: Project) => void;
  onDeleted: () => void;
  busy: boolean;
  mutate: (p: Project, change: Change) => Promise<boolean>;
}) {
  const { typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { modulesOff } = usePreferences();
  const navigate = useNavigate();
  const [typing, setTyping] = useState(false);
  const p = row.project;
  const drag = useProjectDrag(p);
  const dragging = useDragging() === p.id;
  const editor = p.myRole === 'owner' || p.myRole === 'editor';
  // The actions the sidebar menu has for the same project, plus the ones of this page.
  const { trigger, targetProps, layer } = useProjectMenu(
    p,
    [
      {
        label: t(p.pinned ? 'projectsPage.unpin' : 'projectsPage.pin'),
        disabled: busy,
        action: () => void mutate(p, 'pin'),
      },
      ...(user ? addBoardItems(p, t, navigate, modulesOff, onError) : []),
      ...(editor
        ? [{ label: t('projectsPage.details'), disabled: busy, action: () => setTyping(true) }]
        : []),
      ...(p.myRole === 'owner'
        ? [
            {
              label: t(p.archivedAt ? 'projectsPage.unarchive' : 'projectsPage.archive'),
              trailing: true,
              disabled: busy,
              action: () => void mutate(p, 'archive'),
            },
          ]
        : []),
    ],
    onAppearanceSaved,
    onDeleted,
  );
  const year = new Date().getFullYear();
  const date = (value: string) =>
    formatDateTime(`${value}T12:00:00`, {
      day: 'numeric',
      month: 'short',
      ...(value.startsWith(String(year)) ? {} : { year: 'numeric' }),
    });
  const dates = [...new Set([p.shootingStart, p.shootingEnd])]
    .filter((d): d is string => !!d)
    .map(date)
    .join(' – ');
  // Type and dates only once they are set (decision 0124).
  const meta = [
    p.type && typeLabel(p.type),
    t('projectsPage.boards', { count: row.boards.length }),
    dates,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <CoverCard
      className={`project-card${dragging ? ' is-dragging' : ''}`}
      {...targetProps}
      {...drag}
      cover={<BoardPreview boardId={p.rootBoardId} project={p} />}
      overlay={
        <>
          {(p.pinned || p.archivedAt) && (
            <span className="project-card__badge">
              {t(p.archivedAt ? 'projectsPage.archived' : 'projectsPage.pinned')}
            </span>
          )}
          {trigger('project-card__options')}
        </>
      }
      name={
        <>
          <ProjectGlyph {...p.icon} />
          <h2 className="project-card__title">
            <Link to={`/p/${p.id}`} className="ink-cover-card__link">
              {p.name}
            </Link>
          </h2>
        </>
      }
      meta={meta}
      foot={
        <>
          <span className="project-card__members">
            {row.members.map((m) => (
              <span key={m.user.id} title={m.user.name}>
                <Avatar image={m.user.image} name={m.user.name} size={22} />
              </span>
            ))}
          </span>
          <time dateTime={row.activity}>{relativeTime(row.activity, i18n.language)}</time>
        </>
      }
    >
      {layer}
      {typing && (
        <ProjectTypeDialog
          project={p}
          onClose={() => setTyping(false)}
          onSave={(change) => mutate(p, change)}
        />
      )}
    </CoverCard>
  );
}

/** The device's own zone: what the call sheet uses while the project has none. */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneLabel = (zone: string) => zone.replaceAll('_', ' ');

function ProjectTypeDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  /** Resolves to whether the change was saved; on failure the dialog stays open. */
  onSave: (change: { type: string | null; timeZone?: string | null }) => Promise<boolean>;
}) {
  const { catalogs, typeLabel } = useClassifications();
  const { t } = useTranslation();
  const [type, setType] = useState(project.type ?? '');
  const [zone, setZone] = useState(project.timeZone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // The platform lists only geographic zones: UTC is added once, so a project can be set to it.
  const zones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];
  const hintId = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    const saved = await onSave({
      type: type || null,
      ...(zone !== (project.timeZone ?? '') ? { timeZone: zone || null } : {}),
    });
    setBusy(false);
    if (saved) onClose();
    else setError(true);
  }
  return (
    <Dialog
      open
      title={`${t('projectsPage.details')} · ${project.name}`}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form className="settings__form" onSubmit={submit}>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
        <label className="project-type-field">
          {t('onboarding.type')}
          <Select className="ink-input" value={type} disabled={busy} onChange={(e) => setType(e)}>
            <option value="">—</option>
            {project.type && !catalogs.projectTypes.some((o) => o.id === project.type) && (
              <option value={project.type}>{project.type}</option>
            )}
            {catalogs.projectTypes
              .filter((o) => !o.archived || o.id === project.type)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {typeLabel(o.id)}
                </option>
              ))}
          </Select>
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
        <label className="project-type-field">
          {t('projectsPage.timeZone')}
          <Select
            className="ink-input"
            value={zone}
            disabled={busy}
            aria-describedby={hintId}
            onChange={(e) => setZone(e)}
          >
            <option value="">
              {t('projectsPage.timeZoneAuto', { zone: zoneLabel(deviceZone()) })}
            </option>
            {project.timeZone && !zones.includes(project.timeZone) && (
              <option value={project.timeZone}>{zoneLabel(project.timeZone)}</option>
            )}
            {zones.map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </Select>
        </label>
        <small id={hintId} className="ink-muted">
          {t('projectsPage.timeZoneHint')}
        </small>
        {error && <p role="alert">{t('projectsPage.saveError')}</p>}
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('settings.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
