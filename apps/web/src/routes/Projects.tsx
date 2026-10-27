import type { Project } from '@inkadra/shared';
import { Avatar, Button, ProjectGlyph } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { pickVariant, useAsset } from '../board/assets.ts';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { useSession } from '../lib/session.tsx';
import { relativeTime } from '../notifications/Notifications.tsx';
import { useProjects } from './AppLayout.tsx';
import { refreshProjects } from './projects.ts';
import {
  archivedProjects,
  filterProjects,
  type ProjectOverview,
  projectOverviews,
} from './projects-overview.ts';
import './projects.css';

export function Projects() {
  const { catalogs, typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { openNewProject } = useProjects();
  const [items, setItems] = useState<ProjectOverview[] | null>(null);
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
  async function mutate(project: Project, pin: boolean, type?: string) {
    setBusy(true);
    setError(false);
    try {
      const updated =
        type !== undefined
          ? await api.patch<Project>(`/projects/${project.id}`, { type: type || null })
          : pin
            ? await api.put<Project>(`/projects/${project.id}/pin`, { pinned: !project.pinned })
            : await api.patch<Project>(`/projects/${project.id}`, {
                archived: !project.archivedAt,
              });
      setItems(
        (current) =>
          current?.map((row) =>
            row.project.id === updated.id ? { ...row, project: updated } : row,
          ) ?? null,
      );
      await refreshProjects();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const people = new Map(
    items?.flatMap((row) => row.members.map((m) => [m.user.id, m.user] as const)),
  );
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
        <div>
          <Link to="/onboarding">{t('onboarding.guidedSetup')}</Link>
          <Button variant="primary" icon="plus" onClick={openNewProject}>
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
            <Button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
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
          <ProjectCard key={row.project.id} row={row} busy={busy} mutate={mutate} />
        ))}
      </div>
      {user?.role === 'admin' && (
        <p className="ink-muted projects-page__storage">
          {usage !== null
            ? t('projectsPage.storage', {
                bytes: new Intl.NumberFormat(i18n.language).format(usage),
              })
            : usageError
              ? t('projectsPage.storageError')
              : t('comments.loading')}
        </p>
      )}
    </div>
  );
}

function ProjectCard({
  row,
  busy,
  mutate,
}: {
  row: ProjectOverview;
  busy: boolean;
  mutate: (p: Project, pin: boolean, type?: string) => Promise<void>;
}) {
  const { catalogs, typeLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const p = row.project;
  const coverId = row.boards.find((b) => b.id === p.rootBoardId)?.coverAssetId;
  const cover = useAsset(coverId ?? undefined);
  const src = cover && cover !== 'missing' ? pickVariant(cover, 512) : '';
  const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(i18n.language);
  return (
    <article className="ink-card project-card">
      <Link
        to={`/p/${p.id}`}
        className="project-card__cover"
        aria-label={t('projectsPage.openNamed', { name: p.name })}
      >
        {src ? (
          <img src={src} alt="" />
        ) : (
          <ProjectGlyph shape={p.icon.shape} color={p.icon.color} />
        )}
      </Link>
      <div className="project-card__body">
        <div className="project-card__title">
          <h2>
            <Link to={`/p/${p.id}`}>{p.name}</Link>
          </h2>
          {p.type && <span className="project-card__type">{typeLabel(p.type)}</span>}
        </div>
        {(p.myRole === 'owner' || p.myRole === 'editor') && (
          <label>
            {t('onboarding.type')}
            <select
              className="ink-input"
              value={p.type ?? ''}
              disabled={busy}
              onChange={(e) => void mutate(p, false, e.target.value)}
            >
              <option value="">—</option>
              {p.type && !catalogs.projectTypes.some((o) => o.id === p.type) && (
                <option value={p.type}>{p.type}</option>
              )}
              {catalogs.projectTypes
                .filter((o) => !o.archived || o.id === p.type)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {typeLabel(o.id)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <p className="ink-muted">
          {[
            p.shootingStart ? date(p.shootingStart) : null,
            p.shootingEnd ? date(p.shootingEnd) : null,
          ]
            .filter(Boolean)
            .join(' – ') || t('projectsPage.noDates')}{' '}
          · {t('projectsPage.boards', { count: row.boards.length })}
        </p>
        <div className="project-card__members">
          {row.members.map((m) => (
            <span key={m.user.id} title={m.user.name}>
              <Avatar image={m.user.image} name={m.user.name} size={24} />
            </span>
          ))}
          <time className="ink-muted" dateTime={row.activity}>
            {relativeTime(row.activity, i18n.language)}
          </time>
        </div>
        <div className="project-card__actions">
          <Link className="ink-btn ink-btn--secondary" to={`/p/${p.id}`}>
            {t('projectsPage.open')}
          </Link>
          <Button disabled={busy} aria-pressed={!!p.pinned} onClick={() => void mutate(p, true)}>
            {t(p.pinned ? 'projectsPage.unpin' : 'projectsPage.pin')}
          </Button>
          {p.myRole === 'owner' && (
            <Button disabled={busy} onClick={() => void mutate(p, false)}>
              {t(p.archivedAt ? 'projectsPage.unarchive' : 'projectsPage.archive')}
            </Button>
          )}
        </div>
        {p.archivedAt && <span className="ink-muted">{t('projectsPage.archived')}</span>}
      </div>
    </article>
  );
}
