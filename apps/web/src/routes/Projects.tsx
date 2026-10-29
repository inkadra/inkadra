import type { Project } from '@inkadra/shared';
import { Avatar, Button, Dialog, DialogActions } from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { useSession } from '../lib/session.tsx';
import { relativeTime } from '../notifications/Notifications.tsx';
import { useProjects } from './AppLayout.tsx';
import { BoardPreview } from './BoardPreview.tsx';
import { useProjectMenu } from './ProjectAppearance.tsx';
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

export function Projects() {
  const { catalogs, typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { openNewProject } = useProjects();
  const [items, setItems] = useState<ProjectOverview[] | null>(null);
  useEffect(
    () =>
      subscribeProjects(() => {
        const cached = getCachedProjects();
        if (cached)
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
            </p>
          )}
        </div>
        <div className="projects-page__actions">
          <Link className="ink-btn ink-btn--ghost" to="/onboarding">
            {t('onboarding.guidedSetup')}
          </Link>
          <Button variant="primary" icon="plus" onClick={() => openNewProject()}>
            {t('nav.newProject')}
          </Button>
        </div>
      </header>
      <div className="projects-page__filters">
        <label>
          {t('projectsPage.search')}
          <input
            className="ink-input"
            type="search"
            value={query.search}
            onChange={(e) => change('search', e.target.value)}
          />
        </label>
        <label>
          {t('projectsPage.status')}
          <select
            className="ink-input"
            value={query.status}
            onChange={(e) => change('status', e.target.value)}
          >
            {['all', 'active', 'archived'].map((v) => (
              <option key={v} value={v}>
                {t(`projectsPage.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('onboarding.type')}
          <select
            className="ink-input"
            value={query.type}
            onChange={(e) => change('type', e.target.value)}
          >
            <option value="all">{t('projectsPage.all')}</option>
            {catalogs.projectTypes.map(({ id: v }) => (
              <option key={v} value={v}>
                {typeLabel(v)}
              </option>
            ))}
          </select>
        </label>
        {others && (
          <label>
            {t('projectsPage.people')}
            <select
              className="ink-input"
              value={query.person}
              onChange={(e) => change('person', e.target.value)}
            >
              <option value="all">{t('projectsPage.all')}</option>
              {[...people].map(([id, person]) => (
                <option key={id} value={id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('projectsPage.sort')}
          <select
            className="ink-input"
            value={query.sort}
            onChange={(e) => change('sort', e.target.value)}
          >
            {['activity', 'name', 'created'].map((v) => (
              <option key={v} value={v}>
                {t(`projectsPage.sorts.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="projects-page__view">
          {['grid', 'list'].map((v) => (
            <Button key={v} variant="ghost" aria-pressed={view === v} onClick={() => setView(v)}>
              {t(`projectsPage.${v}`)}
            </Button>
          ))}
        </div>
      </div>
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
          <p className="ink-muted">{t('projectsPage.emptyBody')}</p>
        </div>
      )}
      <div className={`projects-page__items projects-page__items--${view}`}>
        {visible.map((row) => (
          <ProjectCard
            key={row.project.id}
            row={row}
            busy={busy}
            mutate={mutate}
            onAppearanceSaved={replace}
          />
        ))}
      </div>
      {user?.role === 'admin' && (
        <p className="ink-muted projects-page__storage">
          {usage !== null
            ? t('projectsPage.storage', {
                bytes: formatStorage(usage, i18n.language),
              })
            : usageError
              ? t('projectsPage.storageError')
              : t('comments.loading')}
        </p>
      )}
    </div>
  );
}

type Change = 'pin' | 'archive' | { type: string | null };

function ProjectCard({
  row,
  busy,
  mutate,
  onAppearanceSaved,
}: {
  row: ProjectOverview;
  onAppearanceSaved: (project: Project) => void;
  busy: boolean;
  mutate: (p: Project, change: Change) => Promise<boolean>;
}) {
  const { typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const [typing, setTyping] = useState(false);
  const p = row.project;
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
      ...(editor
        ? [{ label: t('onboarding.type'), disabled: busy, action: () => setTyping(true) }]
        : []),
      ...(p.myRole === 'owner'
        ? [
            {
              label: t(p.archivedAt ? 'projectsPage.unarchive' : 'projectsPage.archive'),
              disabled: busy,
              action: () => void mutate(p, 'archive'),
            },
          ]
        : []),
    ],
    onAppearanceSaved,
  );
  const date = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const dates =
    [p.shootingStart, p.shootingEnd]
      .filter((d): d is string => !!d)
      .map(date)
      .join(' – ') || t('projectsPage.noDates');
  return (
    <article className="ink-card home__card project-card" {...targetProps}>
      <Link
        to={`/p/${p.id}`}
        className="project-card__cover"
        aria-label={t('projectsPage.openNamed', { name: p.name })}
        tabIndex={-1}
      >
        <BoardPreview boardId={p.rootBoardId} project={p} />
      </Link>
      {(p.pinned || p.archivedAt) && (
        <span className="project-card__badge">
          {t(p.archivedAt ? 'projectsPage.archived' : 'projectsPage.pinned')}
        </span>
      )}
      {trigger('project-card__options')}
      <div className="home__meta project-card__meta">
        <div className="project-card__title">
          <h2 className="home__name">
            <Link to={`/p/${p.id}`}>{p.name}</Link>
          </h2>
          {p.type && <span className="project-card__type">{typeLabel(p.type)}</span>}
        </div>
        <span className="ink-muted home__when">
          {dates} · {t('projectsPage.boards', { count: row.boards.length })}
        </span>
        <div className="project-card__members">
          {row.members.map((m) => (
            <span key={m.user.id} title={m.user.name}>
              <Avatar image={m.user.image} name={m.user.name} size={20} />
            </span>
          ))}
          <time className="ink-muted home__when" dateTime={row.activity}>
            {relativeTime(row.activity, i18n.language)}
          </time>
        </div>
      </div>
      {layer}
      {typing && (
        <ProjectTypeDialog
          project={p}
          onClose={() => setTyping(false)}
          onSave={(type) => mutate(p, { type })}
        />
      )}
    </article>
  );
}

function ProjectTypeDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  /** Resolves to whether the type was saved; on failure the dialog stays open. */
  onSave: (type: string | null) => Promise<boolean>;
}) {
  const { catalogs, typeLabel } = useClassifications();
  const { t } = useTranslation();
  const [type, setType] = useState(project.type ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    const saved = await onSave(type || null);
    setBusy(false);
    if (saved) onClose();
    else setError(true);
  }
  return (
    <Dialog
      open
      title={`${t('onboarding.type')} · ${project.name}`}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form className="settings__form" onSubmit={submit}>
        <label className="project-type-field">
          {t('onboarding.type')}
          <select
            className="ink-input"
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value)}
          >
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
          </select>
        </label>
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
