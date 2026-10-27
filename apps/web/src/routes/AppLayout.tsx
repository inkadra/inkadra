import type { Board, BoardKind, Project } from '@inkadra/shared';
import {
  AppShell,
  Avatar,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  KeyCap,
  Logo,
  NavItem,
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
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { childBoards, useProjectBoards, useSharedBoards } from '../board/boards.ts';
import {
  ALL_VIEWS,
  askedView,
  type BoardView,
  defaultView,
  isBoardView,
  storyboardOf,
  viewDestination,
  viewHref,
} from '../board/views.ts';
import { appActions } from '../commands/app-actions.ts';
import { authApi } from '../lib/api.ts';
import { HeaderContext } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';
import {
  NotificationBell,
  NotificationList,
  useUnreadCount,
} from '../notifications/Notifications.tsx';
import { editableProjects } from './home-data.ts';
import { useInstanceSetup } from './InstanceSetup.tsx';
import { MobileNavigation } from './MobileNavigation.tsx';
import { NewBoardDialog } from './NewBoardDialog.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { ProjectNavItem } from './ProjectAppearance.tsx';
import {
  getCachedProjects,
  refreshProjects,
  setCachedProjects,
  subscribeProjects,
} from './projects.ts';
import { SearchDialog } from './SearchDialog.tsx';
import { SettingsBreadcrumb } from './SettingsBreadcrumb.tsx';
import './mobile-shell.css';

interface ProjectsState {
  projects: Project[] | null;
  shared: Board[] | null;
  openNewProject: () => void;
  openSearch: () => void;
  openInbox: () => void;
  unread: number;
  refreshUnread: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsState>({
  projects: null,
  shared: null,
  openNewProject: () => {},
  openSearch: () => {},
  openInbox: () => {},
  unread: 0,
  refreshUnread: async () => {},
});
export const useProjects = () => useContext(ProjectsContext);

const InstanceSetupContext = createContext<ReturnType<typeof useInstanceSetup>>({
  checks: null,
  error: false,
});
export const useInstanceSetupState = () => useContext(InstanceSetupContext);

export function AppLayout() {
  const setup = useInstanceSetup();
  const { t } = useTranslation();
  const { user, instance, refresh } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const projects = useSyncExternalStore(subscribeProjects, getCachedProjects);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [searching, setSearching] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const mobileInboxButton = useRef<HTMLButtonElement>(null);
  const [unread, refreshUnread] = useUnreadCount();
  const [params, setParams] = useSearchParams();
  const shared = useSharedBoards(!!user);

  useEffect(() => {
    if (user) void refreshProjects();
  }, [user]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeDrawer = () => setDrawerOpen(false);
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);

  // ⌘K / Ctrl+K opens the search from anywhere, even inside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (
        (mac ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'k'
      ) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pathProject = pathname.startsWith('/p/') ? pathname.split('/')[2] : undefined;
  const { items: projectBoards } = useProjectBoards(pathProject);

  if (!user)
    return (
      <Navigate
        to={pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`}
        replace
      />
    );

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    setDrawerOpen(false);
    navigate(to);
  };

  async function signOut() {
    await authApi.signOut();
    setCachedProjects(null);
    await refresh();
  }

  const projectId = pathname.startsWith('/p/') ? pathname.split('/')[2] : undefined;
  const boardId = pathname.split('/')[4];
  const current = projects?.find((p) => p.id === projectId);
  const openBoardId = boardId ?? current?.rootBoardId;
  const storyboardId = storyboardOf(projectBoards);
  // Until the project's boards are known the kind is too: no tab is active before that.
  const openBoard = projectBoards?.find((b) => b.id === openBoardId);
  const openKind: BoardKind | undefined = openBoard?.kind;
  const asked = params.get('view');
  // While the boards load a board with no ?view= has no known default: nothing is active yet.
  const currentView: BoardView | null =
    openBoardId && !projectBoards
      ? isBoardView(asked)
        ? asked
        : null
      : askedView(asked, openKind);

  const destination = (v: BoardView) =>
    viewDestination(
      v,
      { boardId: openBoardId, kind: openKind, rootBoardId: current?.rootBoardId },
      storyboardId,
    );

  const hrefFor = (v: BoardView) => {
    if (!projectId) return pathname;
    return viewHref(projectId, destination(v), {
      boardId: openBoardId ?? '',
      rootBoardId: current?.rootBoardId,
      kind: openKind,
    });
  };

  // The header switcher, the rail and the sidebar all open a view the same way.
  const showView = (v: BoardView) => {
    if (!projectId) return;
    setDrawerOpen(false);
    const target = destination(v);
    if (target.boardId) {
      navigate(hrefFor(v));
      return;
    }
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === defaultView(openKind)) next.delete('view');
        else next.set('view', v);
        return next;
      },
      { replace: true },
    );
  };

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
      <RailButton
        icon="board"
        label={t('nav.board')}
        disabled={!projectId}
        active={!!projectId && currentView === 'canvas'}
        onClick={() => {
          if (projectId) showView('canvas');
        }}
      />
      <RailButton
        icon="storyboard"
        label={t('nav.storyboard')}
        disabled={!projectId}
        active={!!projectId && currentView === 'storyboard'}
        onClick={() => {
          if (projectId) showView('storyboard');
        }}
      />
      <RailButton
        icon="shotlist"
        label={t('nav.shotlist')}
        disabled={!projectId}
        active={!!projectId && currentView === 'shotlist'}
        onClick={() => {
          if (projectId) showView('shotlist');
        }}
      />
      <RailButton
        icon="calendar"
        label={t('nav.schedule')}
        disabled={!projectId}
        active={!!projectId && currentView === 'schedule'}
        onClick={() => {
          if (projectId) showView('schedule');
        }}
      />
      <RailButton
        icon="people"
        label={t('nav.clients')}
        disabled={!projectId}
        active={!!projectId && currentView === 'review'}
        onClick={() => {
          if (projectId) showView('review');
        }}
      />
      <RailSeparator />
      <RailButton
        icon="inbox"
        label={t('nav.inbox')}
        badge={unread > 0 ? unread : undefined}
        active={inboxOpen}
        onClick={() => {
          setDrawerOpen(false);
          setInboxOpen((o) => !o);
        }}
      />
      <RailButton
        icon="search"
        label={t('nav.search')}
        onClick={() => {
          setDrawerOpen(false);
          setSearching(true);
        }}
      />
      <RailSpacer />
      <RailButton
        icon={theme === 'dark' ? 'sun' : 'moon'}
        label={theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
        onClick={toggle}
      />
      <span
        className={
          setup.error || setup.checks?.some((c) => !c.ok) ? 'instance-setup-reminder' : undefined
        }
      >
        <RailButton
          icon="settings"
          label={t(
            setup.error || setup.checks?.some((c) => !c.ok)
              ? 'onboarding.settingsPending'
              : 'nav.settings',
          )}
          active={pathname.startsWith('/settings')}
          onClick={() => navigate('/settings')}
        />
      </span>
      <RailButton icon="logout" label={t('auth.signOut')} onClick={signOut} />
      <span style={{ marginTop: 4 }}>
        <Avatar image={user.image} name={user.name} />
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
      <button
        type="button"
        className="ink-sidebar__search"
        onClick={() => {
          setDrawerOpen(false);
          setSearching(true);
        }}
      >
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
      <NavItem
        icon="inbox"
        label={t('nav.inbox')}
        count={unread}
        active={inboxOpen}
        onClick={(e) => {
          e.preventDefault();
          setDrawerOpen(false);
          setInboxOpen((o) => !o);
        }}
      />
      <NavItem
        icon="board"
        label={t('nav.projects')}
        href="/projects"
        active={pathname === '/projects'}
        onClick={go('/projects')}
      />
      <SidebarSection
        title={t('nav.projects')}
        action={
          <IconButton
            icon="plus"
            label={t('nav.newProject')}
            onClick={() => {
              setDrawerOpen(false);
              setCreating(true);
            }}
          />
        }
      />
      {projects?.map((p) => (
        <div key={p.id}>
          <ProjectNavItem
            project={p}
            active={p.id === projectId && !boardId}
            onClick={go(`/p/${p.id}`)}
          />
          {p.id === projectId && (
            <>
              <NavItem
                icon="storyboard"
                label={t('nav.storyboard')}
                active={currentView === 'storyboard'}
                href={hrefFor('storyboard')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('storyboard');
                }}
                style={{ paddingLeft: 22 }}
              />
              <NavItem
                icon="shotlist"
                label={t('nav.shotlist')}
                active={currentView === 'shotlist'}
                href={hrefFor('shotlist')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('shotlist');
                }}
                style={{ paddingLeft: 22 }}
              />
              <NavItem
                icon="calendar"
                label={t('nav.schedule')}
                active={currentView === 'schedule'}
                href={hrefFor('schedule')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('schedule');
                }}
                style={{ paddingLeft: 22 }}
              />
              <NavItem
                icon="people"
                label={t('nav.clients')}
                active={currentView === 'review'}
                href={hrefFor('review')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('review');
                }}
                style={{ paddingLeft: 22 }}
              />
              <BoardTree
                projectId={p.id}
                parentId={p.rootBoardId}
                activeId={boardId}
                depth={1}
                go={go}
              />
            </>
          )}
        </div>
      ))}
      {shared && shared.length > 0 && (
        <>
          <SidebarSection title={t('nav.shared')} />
          {shared.map((b) => (
            <NavItem
              key={b.id}
              icon="people"
              label={b.title}
              href={`/p/${b.projectId}/b/${b.id}`}
              active={b.id === boardId}
              onClick={go(`/p/${b.projectId}/b/${b.id}`)}
            />
          ))}
        </>
      )}
    </Sidebar>
  );

  const header = (
    <Header>
      <div className="mobile-header-actions">
        {projectId && (
          <IconButton
            className="mobile-back"
            icon="chevronRight"
            label={t('mobile.back')}
            onClick={() => navigate(boardId ? `/p/${projectId}` : '/')}
          />
        )}
        <IconButton
          icon="board"
          label={t('nav.navigation')}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        />
      </div>
      <div className="shell-header-content">
        {headerContent ?? (
          <>
            <nav aria-label={t('nav.breadcrumb')} className="ink-header__crumbs">
              {pathname === '/settings' || pathname === '/settings/team' ? (
                <SettingsBreadcrumb pathname={pathname} search={search} />
              ) : (
                <span style={{ fontWeight: 600 }}>
                  {current?.name ??
                    t(
                      pathname === '/projects'
                        ? 'nav.projects'
                        : pathname === '/onboarding'
                          ? 'onboarding.title'
                          : 'nav.home',
                    )}
                </span>
              )}
            </nav>
            <span className="ink-header__spacer" />
            <span
              className="ink-muted"
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <KeyCap>⌘K</KeyCap>
              {t('home.searchHint')}
            </span>
          </>
        )}
      </div>
      {projectId && (
        <select
          className="mobile-view-switcher"
          aria-label={t('film.views.label')}
          value={currentView ?? ''}
          onChange={(e) => showView(e.target.value as BoardView)}
        >
          {ALL_VIEWS.map((v) => (
            <option key={v} value={v}>
              {t(`film.views.${v}`)}
            </option>
          ))}
        </select>
      )}
      <NotificationBell unread={unread} onCount={refreshUnread} />
    </Header>
  );

  return (
    <InstanceSetupContext.Provider value={setup}>
      <ProjectsContext.Provider
        value={{
          projects,
          shared,
          openNewProject: () => setCreating(true),
          openSearch: () => setSearching(true),
          openInbox: () => setInboxOpen(true),
          unread,
          refreshUnread,
        }}
      >
        <HeaderContext.Provider value={setHeaderContent}>
          <AppShell rail={rail} sidebar={sidebar} header={header} canvas={!!projectId}>
            <Outlet />
          </AppShell>
        </HeaderContext.Provider>
        <MobileNavigation
          inboxButtonRef={mobileInboxButton}
          pathname={pathname}
          inboxOpen={inboxOpen}
          drawerOpen={drawerOpen}
          unread={unread}
          onHome={() => {
            setInboxOpen(false);
            navigate('/');
          }}
          onProjects={() => {
            setInboxOpen(false);
            setDrawerOpen(true);
          }}
          onNew={() => {
            setInboxOpen(false);
            setCreating(true);
          }}
          onInbox={() => setInboxOpen((o) => !o)}
          onProfile={() => {
            setInboxOpen(false);
            navigate('/settings');
          }}
        />
        {drawerOpen && (
          <div className="mobile-drawer">
            <Dialog open title={t('nav.navigation')} onClose={() => setDrawerOpen(false)}>
              <Button
                variant="ghost"
                block
                className="mobile-drawer__close"
                onClick={() => setDrawerOpen(false)}
              >
                {t('mobile.close')}
              </Button>
              {sidebar}
              <Button variant="ghost" block onClick={toggle}>
                {theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
              </Button>
              <Button variant="ghost" block onClick={signOut}>
                {t('auth.signOut')}
              </Button>
            </Dialog>
          </div>
        )}
        {searching && (
          <SearchDialog
            projects={projects}
            shared={shared}
            onClose={() => setSearching(false)}
            actions={appActions({
              t,
              admin: user.role === 'admin',
              canCreateBoard: editableProjects(projects).length > 0,
              theme,
              navigate,
              newProject: () => setCreating(true),
              newBoard: () => setCreatingBoard(true),
              toggleTheme: toggle,
              openInbox: () => setInboxOpen(true),
            })}
          />
        )}
        {inboxOpen && (
          <NotificationList
            fixed
            bell={mobileInboxButton}
            onClose={() => {
              setInboxOpen(false);
              if (window.matchMedia('(width < 768px)').matches) mobileInboxButton.current?.focus();
            }}
            unread={unread}
            onNavigate={() => setInboxOpen(false)}
            onCount={refreshUnread}
          />
        )}
        {/* Mounted only while open: a closed dialog would still leave its fields in the page. */}
        {creatingBoard && (
          <NewBoardDialog
            open
            projects={editableProjects(projects)}
            initial="blank"
            onClose={() => setCreatingBoard(false)}
          />
        )}
        <NewProjectDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={async (p) => {
            setCreating(false);
            await refreshProjects();
            navigate(`/p/${p.id}`);
          }}
        />
      </ProjectsContext.Provider>
    </InstanceSetupContext.Provider>
  );
}

/** Sub-boards of the open project, as nested links under the project in the sidebar. */
function BoardTree({
  projectId,
  parentId,
  activeId,
  depth,
  go,
}: {
  projectId: string;
  parentId: string;
  activeId: string | undefined;
  depth: number;
  go: (to: string) => (e: MouseEvent) => void;
}) {
  const { items } = useProjectBoards(projectId);
  const children = childBoards(items, parentId);
  if (children.length === 0 || depth > 4) return null;
  return (
    <>
      {children.map((b) => (
        <div key={b.id}>
          <NavItem
            label={b.title}
            href={`/p/${projectId}/b/${b.id}`}
            active={b.id === activeId}
            onClick={go(`/p/${projectId}/b/${b.id}`)}
            style={{ paddingLeft: 8 + depth * 14 }}
          />
          <BoardTree
            projectId={projectId}
            parentId={b.id}
            activeId={activeId}
            depth={depth + 1}
            go={go}
          />
        </div>
      ))}
    </>
  );
}
