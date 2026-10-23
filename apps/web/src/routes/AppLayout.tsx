import type { Project } from '@inkadra/shared';
import {
  AppShell,
  Avatar,
  Header,
  Icon,
  IconButton,
  KeyCap,
  Logo,
  NavItem,
  ProjectGlyph,
  Rail,
  RailButton,
  RailSeparator,
  RailSpacer,
  Sidebar,
  SidebarSection,
} from '@inkadra/ui';
import {
  createContext,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api, authApi } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';
import { NewProjectDialog } from './NewProjectDialog.tsx';

interface ProjectsState {
  projects: Project[] | null;
  openNewProject: () => void;
}

const ProjectsContext = createContext<ProjectsState>({ projects: null, openNewProject: () => {} });
export const useProjects = () => useContext(ProjectsContext);

export function AppLayout() {
  const { t } = useTranslation();
  const { user, instance, refresh } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const page = await api.get<{ items: Project[] }>('/projects');
    setProjects(page.items);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (!user) return <Navigate to="/login" replace />;

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };

  async function signOut() {
    await authApi.signOut();
    await refresh();
  }

  const projectId = pathname.startsWith('/p/') ? pathname.split('/')[2] : undefined;
  const current = projects?.find((p) => p.id === projectId);

  const rail = (
    <Rail label={t('nav.modules')}>
      <span className="ink-rail__logo">
        <Logo />
      </span>
      <RailButton
        icon="home"
        label={t('nav.home')}
        active={pathname === '/'}
        onClick={() => navigate('/')}
      />
      <RailButton icon="board" label={t('nav.board')} active={!!projectId} />
      <RailButton icon="storyboard" label={t('nav.storyboard')} disabled />
      <RailButton icon="shotlist" label={t('nav.shotlist')} disabled />
      <RailButton icon="calendar" label={t('nav.schedule')} disabled />
      <RailButton icon="people" label={t('nav.clients')} disabled />
      <RailSeparator />
      <RailButton icon="inbox" label={t('nav.inbox')} disabled />
      <RailButton icon="search" label={t('nav.search')} disabled />
      <RailSpacer />
      <RailButton
        icon={theme === 'dark' ? 'sun' : 'moon'}
        label={theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
        onClick={toggle}
      />
      <RailButton icon="settings" label={t('nav.settings')} disabled />
      <RailButton icon="logout" label={t('auth.signOut')} onClick={signOut} />
      <span style={{ marginTop: 4 }}>
        <Avatar name={user.name} />
      </span>
    </Rail>
  );

  const sidebar = (
    <Sidebar label={t('nav.navigation')}>
      <div className="ink-sidebar__workspace">
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--ink-text-primary)',
          }}
        />
        <span className="ink-nav__name">{instance?.name}</span>
      </div>
      <button type="button" className="ink-sidebar__search" disabled>
        <Icon name="search" size={14} />
        {t('nav.search')}
        <span style={{ flex: 1 }} />
        <KeyCap>⌘K</KeyCap>
      </button>
      <NavItem
        icon="home"
        label={t('nav.home')}
        href="/"
        active={pathname === '/'}
        onClick={go('/')}
      />
      <NavItem icon="inbox" label={t('nav.inbox')} count={0} />
      <NavItem icon="assigned" label={t('nav.assigned')} count={0} />
      <NavItem icon="unsorted" label={t('nav.unsorted')} count={0} />
      <SidebarSection
        title={t('nav.projects')}
        action={
          <IconButton icon="plus" label={t('nav.newProject')} onClick={() => setCreating(true)} />
        }
      />
      {projects?.map((p) => (
        <NavItem
          key={p.id}
          leading={<ProjectGlyph shape={p.icon.shape} color={p.icon.color} />}
          label={p.name}
          href={`/p/${p.id}`}
          active={p.id === projectId}
          onClick={go(`/p/${p.id}`)}
        />
      ))}
      <SidebarSection title={t('nav.pinned')} />
      <div className="ink-muted" style={{ padding: '0 8px', fontSize: 12 }}>
        {t('home.noPinned')}
      </div>
      <div className="ink-sidebar__footer">
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-status-ok)' }}
        />
        {t('nav.synced')}
      </div>
    </Sidebar>
  );

  const header = (
    <Header>
      <nav aria-label={t('nav.breadcrumb')} className="ink-header__crumbs">
        <span style={{ fontWeight: 600 }}>{current?.name ?? t('nav.home')}</span>
      </nav>
      <span className="ink-header__spacer" />
      <span
        className="ink-muted"
        style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <KeyCap>⌘K</KeyCap>
        {t('home.searchHint')}
      </span>
    </Header>
  );

  return (
    <ProjectsContext.Provider value={{ projects, openNewProject: () => setCreating(true) }}>
      <AppShell rail={rail} sidebar={sidebar} header={header} canvas={!!projectId}>
        <Outlet />
      </AppShell>
      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (p) => {
          setCreating(false);
          await load();
          navigate(`/p/${p.id}`);
        }}
      />
    </ProjectsContext.Provider>
  );
}
