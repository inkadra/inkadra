import { Select } from '@inkadra/ui';
import type { Board, BoardCount, BoardKind, Project } from '@inkadra/shared';
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
  Sidebar,
  SidebarSection,
} from '@inkadra/ui';
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  createPath,
  UNSAFE_DataRouterContext as DataRouterContext,
  type Location,
  UNSAFE_LocationContext as LocationContext,
  Navigate,
  UNSAFE_NavigationContext as NavigationContext,
  useLocation,
  useNavigate,
  useNavigationType,
  useOutlet,
  useSearchParams,
} from 'react-router';
import { childBoards, useProjectBoards, useSharedBoards } from '../board/boards.ts';
import {
  askedView,
  type BoardView,
  defaultView,
  isBoardView,
  isFilmView,
  pickerViews,
  storyboardOf,
  viewDestination,
  viewHref,
  viewIcon,
} from '../board/views.ts';
import { appActions } from '../commands/app-actions.ts';
import { canCreateProjects } from '../lib/access.ts';
import { api, authApi } from '../lib/api.ts';
import { HeaderContext } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';
import {
  NotificationBell,
  NotificationList,
  useNotificationFeed,
  useUnreadCount,
} from '../notifications/Notifications.tsx';
import { editableProjects } from './home-data.ts';
import { useInstanceSetup } from './InstanceSetup.tsx';
import { MobileNavigation } from './MobileNavigation.tsx';
import { NewBoardDialog } from './NewBoardDialog.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { ProjectNavItem } from './ProjectAppearance.tsx';
import { ImportProjectDialog } from './ProjectTransfer.tsx';
import { onboardingTitle, type ProjectTemplate } from './project-setup.ts';
import {
  getCachedProjects,
  refreshProjects,
  setCachedProjects,
  subscribeProjects,
} from './projects.ts';
import { SearchDialog } from './SearchDialog.tsx';
import { SettingsWindow } from './SettingsWindow.tsx';
import {
  forgetSeededCounts,
  mergeSeededCounts,
  SeedQueue,
  useSeededCounts,
} from './seed-queue.tsx';
import { isSettingsPath } from './settings-sections.ts';
import './mobile-shell.css';

interface ProjectsState {
  projects: Project[] | null;
  shared: Board[] | null;
  /** Opens New project, optionally with a template already chosen. */
  openNewProject: (template?: ProjectTemplate) => void;
  /** Opens Import project… (decision 0037). */
  openImportProject: () => void;
  /** False when an administrator keeps project creation to some people (decision 0041). */
  canCreateProjects: boolean;
  openSearch: () => void;
  openInbox: () => void;
  unread: number;
  refreshUnread: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsState>({
  projects: null,
  shared: null,
  openNewProject: () => {},
  openImportProject: () => {},
  canCreateProjects: true,
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

const HOME: Location = { pathname: '/', search: '', hash: '', state: null, key: 'default' };

/**
 * Settings open as a window over the page underneath, which stays mounted: a board keeps its
 * connection and scroll. The page is the last one shown before settings opened, or Home when
 * a settings URL is loaded directly (decision 0029). History entry positions distinguish Back
 * from Forward; the underlay also isolates navigation, including data-router navigation.
 */
function useSettingsOverlay(home: ReactNode) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const outlet = useOutlet();
  const open = isSettingsPath(location.pathname);
  const page = useRef<{ element: ReactNode; location: Location } | null>(null);
  if (!open) page.current = { element: outlet, location };
  const history = useRef({
    entries: new Map<string, { position: number; base: number }>(),
    current: { position: 0, base: 0 },
    key: '',
  });
  // Remember entry positions rather than counting POPs: a POP can also be Forward.
  const tracker = history.current;
  if (tracker.key !== location.key) {
    const known = tracker.entries.get(location.key);
    const position =
      navigationType === 'PUSH' ? tracker.current.position + 1 : tracker.current.position;
    const entry = known ?? {
      position,
      base: open ? tracker.current.base : position,
    };
    tracker.entries.set(location.key, entry);
    tracker.current = entry;
    tracker.key = location.key;
  }
  const depth = tracker.current.position - tracker.current.base;
  const below = open ? (page.current ?? { element: home, location: HOME }) : null;
  return {
    open,
    /** The settings page itself, for the window. */
    settings: open ? outlet : null,
    location: below?.location ?? location,
    content: below?.element ?? outlet,
    navigationType,
    depth,
  };
}

/**
 * Keep these providers mounted even when settings are closed, so existing async callbacks
 * use the same guarded navigator. Data routes bypass NavigationContext in useNavigateStable.
 * Drop underlay navigations while covered: stale effects must never change the modal URL.
 */
function UnderlayNavigation({ open, children }: { open: boolean; children: ReactNode }) {
  const blocked = useRef(open);
  blocked.current = open;
  const navigation = useContext(NavigationContext);
  const data = useContext(DataRouterContext);
  const guardedNavigation = useMemo(
    () => ({
      ...navigation,
      navigator: {
        ...navigation.navigator,
        push: (...args: Parameters<typeof navigation.navigator.push>) => {
          if (!blocked.current) navigation.navigator.push(...args);
        },
        replace: (...args: Parameters<typeof navigation.navigator.replace>) => {
          if (!blocked.current) navigation.navigator.replace(...args);
        },
        go: (delta: number) => {
          if (!blocked.current) navigation.navigator.go(delta);
        },
      },
    }),
    [navigation],
  );
  const guardedData = useMemo(
    () =>
      data && {
        ...data,
        // Preserve the live router getters (notably state) rather than copying a snapshot.
        router: new Proxy(data.router, {
          get(target, property, receiver) {
            if (property === 'navigate')
              return ((...args: Parameters<typeof target.navigate>) =>
                blocked.current
                  ? Promise.resolve()
                  : target.navigate(...args)) as typeof target.navigate;
            return Reflect.get(target, property, receiver);
          },
        }),
      },
    [data],
  );
  return (
    <NavigationContext.Provider value={guardedNavigation}>
      <DataRouterContext.Provider value={guardedData}>{children}</DataRouterContext.Provider>
    </NavigationContext.Provider>
  );
}

export function AppLayout({ home }: { home?: ReactNode }) {
  const setup = useInstanceSetup();
  const { t } = useTranslation();
  const { user, instance, refresh } = useSession();
  const canCreate = canCreateProjects(user);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const url = useLocation();
  const overlay = useSettingsOverlay(home);
  // A stable value, so the page underneath does not re-render on every layout render.
  const underlayLocation = useMemo(
    () => ({ location: overlay.location, navigationType: overlay.navigationType }),
    [overlay.location, overlay.navigationType],
  );
  const afterSettings = useRef<string | null>(null);
  useEffect(() => {
    if (overlay.open || !afterSettings.current) return;
    const destination = afterSettings.current;
    afterSettings.current = null;
    void navigate(destination);
  }, [overlay.open, navigate]);

  // Everything in the shell follows the page under the settings window, not the settings URL.
  const { pathname, search } = overlay.location;
  const projects = useSyncExternalStore(subscribeProjects, getCachedProjects);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A template when New project opens with one preselected, as from Home.
  const [creating, setCreating] = useState<boolean | ProjectTemplate>(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [importing, setImporting] = useState(false);
  // The project a new board goes into when it starts from inside that project.
  const [boardProject, setBoardProject] = useState<string | undefined>();
  const [newSheet, setNewSheet] = useState(false);
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [searching, setSearching] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const mobileInboxButton = useRef<HTMLButtonElement>(null);
  // The bell's "Open inbox" leaves the peek: closing the Inbox goes back to the bell.
  const inboxOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!inboxOpen && inboxOpener.current) {
      inboxOpener.current.focus();
      inboxOpener.current = null;
    }
  }, [inboxOpen]);
  const [unread, refreshUnread] = useUnreadCount();
  // One list behind the bell and the Inbox.
  const notifications = useNotificationFeed(refreshUnread);
  const [, setParams] = useSearchParams();
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

  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  // ⌘\ / Ctrl+\ folds the navigation column to its icons and back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => {
          writeCollapsed(!c);
          return !c;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pathProject = pathname.startsWith('/p/') ? pathname.split('/')[2] : undefined;
  const { items: projectBoards } = useProjectBoards(pathProject);
  const counts = useBoardCounts(pathProject, projectBoards);

  if (!user)
    return (
      <Navigate
        to={url.pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(url.pathname)}`}
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

  const inSettings = overlay.open;
  const closeSettings = () => {
    if (overlay.depth > 0) navigate(-overlay.depth);
    else navigate(createPath(overlay.location), { replace: true });
  };
  const writable = editableProjects(projects);
  const projectId = pathname.startsWith('/p/') ? pathname.split('/')[2] : undefined;
  const boardId = pathname.split('/')[4];
  const current = projects?.find((p) => p.id === projectId);
  // The same title as the guided setup page.
  const onboardingCrumb = onboardingTitle(projects);
  // Inside a project the bottom bar's New adds the board there, when the person may.
  const here = writable.find((p) => p.id === projectId);
  const openBoardId = boardId ?? current?.rootBoardId;
  const storyboardId = storyboardOf(projectBoards);
  // Until the project's boards are known the kind is too: no tab is active before that.
  const openBoard = projectBoards?.find((b) => b.id === openBoardId);
  const openKind: BoardKind | undefined = openBoard?.kind;
  const asked = new URLSearchParams(search).get('view');
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

  const setupPending = !!(setup.error || setup.checks?.some((c) => !c.ok));
  const storyboardCounts = storyboardId ? counts.get(storyboardId) : undefined;
  // One row is current at a time: a film view lights its module row, the storyboard's own
  // canvas lights the Storyboard row (the board is not listed again under Boards), and the
  // project row is current only on the root board's own views.
  const filmView = isFilmView(currentView);
  const filmRowActive = (v: BoardView) =>
    currentView === v ||
    (v === 'storyboard' && !filmView && !!storyboardId && openBoardId === storyboardId);

  const sidebar = (
    <Sidebar label={t('nav.navigation')}>
      <div className="ink-sidebar__workspace">
        <Logo />
        <span className="ink-nav__name" style={{ flex: 1 }}>
          {instance?.name}
        </span>
        <IconButton
          className={`ink-sidebar__toggle${collapsed ? ' is-collapsed' : ''}`}
          icon="chevronRight"
          label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          aria-expanded={!(collapsed || inboxOpen)}
          disabled={inboxOpen}
          onClick={toggleCollapsed}
        />
      </div>
      <button
        type="button"
        className="ink-sidebar__search"
        aria-label={t('nav.search')}
        title={t('nav.search')}
        onClick={() => {
          setDrawerOpen(false);
          setSearching(true);
        }}
      >
        <Icon name="search" size={14} />
        <span className="ink-sidebar__search-text">
          {t('nav.search')}
          <KeyCap>⌘K</KeyCap>
        </span>
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
        badge={unread}
        active={inboxOpen}
        onClick={(e) => {
          e.preventDefault();
          inboxOpener.current = e.currentTarget;
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
          canCreate ? (
            <IconButton
              icon="plus"
              label={t('nav.newProject')}
              onClick={() => {
                setDrawerOpen(false);
                setCreating(true);
              }}
            />
          ) : undefined
        }
      />
      {projects?.map((p) => (
        <div key={p.id} className={p.id === projectId ? undefined : 'ink-sidebar__collapsible'}>
          <ProjectNavItem
            project={p}
            active={p.id === projectId && !boardId && !filmView}
            onClick={go(`/p/${p.id}`)}
          />
          {p.id === projectId && (
            <div className="ink-sidebar__modules">
              <NavItem
                icon="storyboard"
                contentKind="storyboard"
                label={t('nav.storyboard')}
                count={storyboardCounts?.frameCount}
                title={
                  storyboardCounts
                    ? `${t('nav.storyboard')} · ${t('nav.shots', { count: storyboardCounts.frameCount })}`
                    : undefined
                }
                active={filmRowActive('storyboard')}
                href={hrefFor('storyboard')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('storyboard');
                }}
              />
              <NavItem
                icon="shotlist"
                contentKind="shotlist"
                label={t('nav.shotlist')}
                count={storyboardCounts?.frameCount}
                title={
                  storyboardCounts
                    ? `${t('nav.shotlist')} · ${t('nav.toShoot', { count: storyboardCounts.frameCount, left: storyboardCounts.framesToShoot })}`
                    : undefined
                }
                active={filmRowActive('shotlist')}
                href={hrefFor('shotlist')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('shotlist');
                }}
              />
              <NavItem
                icon="calendar"
                contentKind="schedule"
                label={t('nav.schedule')}
                active={filmRowActive('schedule')}
                href={hrefFor('schedule')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('schedule');
                }}
              />
              <NavItem
                icon="people"
                contentKind="review"
                label={t('nav.clients')}
                active={filmRowActive('review')}
                href={hrefFor('review')}
                onClick={(e) => {
                  e.preventDefault();
                  showView('review');
                }}
              />
              <div className="ink-sidebar__collapsible">
                <div className="ink-sidebar__label">{t('nav.boards')}</div>
                <BoardTree
                  projectId={p.id}
                  parentId={p.rootBoardId}
                  activeId={boardId}
                  hiddenId={storyboardId}
                  depth={1}
                  go={go}
                  counts={counts}
                />
              </div>
            </div>
          )}
        </div>
      ))}
      {shared && shared.length > 0 && (
        <div className="ink-sidebar__collapsible">
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
        </div>
      )}
      <span className="ink-sidebar__spacer" />
      <div className="ink-sidebar__user">
        <Avatar image={user.image} name={user.name} />
        <span className="ink-sidebar__who">
          <span>{user.name}</span>
          <small>{instance?.name}</small>
        </span>
        <span className="ink-sidebar__user-actions">
          <span className={setupPending ? 'instance-setup-reminder' : undefined}>
            <IconButton
              icon="settings"
              label={t(setupPending ? 'onboarding.settingsPending' : 'nav.settings')}
              aria-current={inSettings ? 'page' : undefined}
              onClick={go('/settings')}
            />
          </span>
          <IconButton
            icon={theme === 'dark' ? 'sun' : 'moon'}
            label={theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')}
            onClick={toggle}
          />
          <IconButton icon="logout" label={t('auth.signOut')} onClick={signOut} />
        </span>
      </div>
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
              <span style={{ fontWeight: 600 }}>
                {current?.name ??
                  (pathname === '/onboarding'
                    ? onboardingCrumb && t(onboardingCrumb)
                    : t(pathname === '/projects' ? 'nav.projects' : 'nav.home'))}
              </span>
            </nav>
            <span className="ink-header__spacer" />
            {/* Home creates from here only; search stays in the sidebar and on ⌘K. */}
            {pathname === '/' && (
              <div className="home-header-actions">
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={writable.length === 0}
                  onClick={() => {
                    setBoardProject(undefined);
                    setCreatingBoard(true);
                  }}
                >
                  {t('home.newBoard.action')}
                </Button>
                {canCreate && (
                  <Button variant="secondary" onClick={() => setCreating(true)}>
                    {t('nav.newProject')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {projectId && (
        <div className="mobile-view-picker">
          <Icon
            name={viewIcon(currentView ?? defaultView(openKind))}
            contentKind={currentView ?? defaultView(openKind)}
            size={18}
          />
          <Select
            className="mobile-view-switcher"
            aria-label={t('film.views.label')}
            value={currentView ?? ''}
            onChange={(e) => showView(e as BoardView)}
          >
            {pickerViews(openKind, currentView).map((v) => (
              <option key={v} value={v}>
                {t(`film.views.${v}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <NotificationBell
        unread={unread}
        onCount={refreshUnread}
        feed={notifications}
        onOpenInbox={(opener) => {
          inboxOpener.current = opener;
          setInboxOpen(true);
        }}
      />
    </Header>
  );

  return (
    <InstanceSetupContext.Provider value={setup}>
      <ProjectsContext.Provider
        value={{
          projects,
          shared,
          openNewProject: (template) => canCreate && setCreating(template ?? true),
          openImportProject: () => canCreate && setImporting(true),
          canCreateProjects: canCreate,
          openSearch: () => setSearching(true),
          openInbox: () => setInboxOpen(true),
          unread,
          refreshUnread,
        }}
      >
        <HeaderContext.Provider value={setHeaderContent}>
          <AppShell
            sidebar={sidebar}
            header={header}
            canvas={!!projectId}
            collapsed={inboxOpen || collapsed}
          >
            {/* Keep layout observable while Inbox covers the board, including sidebar resizes. */}
            <div
              inert={inboxOpen}
              aria-hidden={inboxOpen || undefined}
              style={{
                visibility: inboxOpen ? 'hidden' : 'visible',
                position: 'relative',
                height: '100%',
              }}
            >
              <UnderlayNavigation open={overlay.open}>
                <LocationContext.Provider value={underlayLocation}>
                  {overlay.content}
                </LocationContext.Provider>
              </UnderlayNavigation>
            </div>
            {inboxOpen && (
              <NotificationList
                fixed
                bell={mobileInboxButton}
                onClose={() => {
                  setInboxOpen(false);
                  if (window.matchMedia('(width < 768px)').matches)
                    inboxOpener.current = mobileInboxButton.current;
                }}
                unread={unread}
                onNavigate={() => {
                  inboxOpener.current = null;
                  setInboxOpen(false);
                }}
                onCount={refreshUnread}
                feed={notifications}
              />
            )}
          </AppShell>
        </HeaderContext.Provider>
        <MobileNavigation
          inboxButtonRef={mobileInboxButton}
          pathname={url.pathname}
          inboxOpen={inboxOpen}
          drawerOpen={drawerOpen}
          newOpen={newSheet}
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
            setNewSheet(true);
          }}
          onInbox={() => setInboxOpen((o) => !o)}
          onProfile={() => {
            setInboxOpen(false);
            navigate('/settings');
          }}
        />
        {overlay.settings && (
          <SettingsWindow
            setup={setup}
            onClose={closeSettings}
            onDiagnostics={() => {
              afterSettings.current = '/diagnostics';
              closeSettings();
            }}
            onBack={() =>
              overlay.depth > 1 ? navigate(-1) : navigate('/settings', { replace: true })
            }
          >
            {overlay.settings}
          </SettingsWindow>
        )}
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
            </Dialog>
          </div>
        )}
        {newSheet && (
          <div className="phone-sheet">
            <Dialog open title={t('mobile.createTitle')} onClose={() => setNewSheet(false)}>
              <div className="mobile-new-sheet__actions">
                {canCreate && (
                  <Button
                    block
                    icon="plus"
                    onClick={() => {
                      setNewSheet(false);
                      setCreating(true);
                    }}
                  >
                    {t('nav.newProject')}
                  </Button>
                )}
                <Button
                  block
                  icon="board"
                  disabled={writable.length === 0}
                  onClick={() => {
                    setNewSheet(false);
                    setBoardProject(here?.id);
                    setCreatingBoard(true);
                  }}
                >
                  {here
                    ? t('mobile.newBoardIn', { project: here.name })
                    : t('home.newBoard.action')}
                </Button>
                {/* Phones have no Esc and a tap outside does not close the sheet. */}
                <Button variant="ghost" block onClick={() => setNewSheet(false)}>
                  {t('mobile.close')}
                </Button>
              </div>
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
              canCreateBoard: writable.length > 0,
              theme,
              navigate,
              newProject: canCreate ? () => setCreating(true) : undefined,
              newBoard: () => {
                setBoardProject(undefined);
                setCreatingBoard(true);
              },
              toggleTheme: toggle,
              openInbox: () => setInboxOpen(true),
            })}
          />
        )}
        {/* Mounted only while open: a closed dialog would still leave its fields in the page. */}
        {creatingBoard && (
          <NewBoardDialog
            open
            projects={writable}
            initial="blank"
            initialProject={boardProject}
            onClose={() => setCreatingBoard(false)}
          />
        )}
        <NewProjectDialog
          open={canCreate && creating !== false}
          template={typeof creating === 'string' ? creating : undefined}
          onClose={() => setCreating(false)}
          onImport={() => {
            setCreating(false);
            setImporting(true);
          }}
          onCreated={async (p) => {
            setCreating(false);
            await refreshProjects();
            navigate(`/p/${p.id}`);
          }}
        />
        {canCreate && importing && <ImportProjectDialog onClose={() => setImporting(false)} />}
        <SeedQueue />
      </ProjectsContext.Provider>
    </InstanceSetupContext.Provider>
  );
}

/** Sub-boards of the open project, as nested links under the project in the sidebar. */
function BoardTree({
  projectId,
  parentId,
  activeId,
  hiddenId,
  depth,
  go,
  counts,
}: {
  projectId: string;
  parentId: string;
  activeId: string | undefined;
  /** The storyboard, already listed as the Storyboard module: its sub-boards take its place. */
  hiddenId: string | null;
  depth: number;
  go: (to: string) => (e: MouseEvent) => void;
  counts: Map<string, BoardCount>;
}) {
  const { t } = useTranslation();
  const { items } = useProjectBoards(projectId);
  const children = childBoards(items, parentId);
  if (children.length === 0 || depth > 4) return null;
  return (
    <>
      {children.map((b) => {
        const below = (
          <BoardTree
            projectId={projectId}
            parentId={b.id}
            activeId={activeId}
            hiddenId={hiddenId}
            depth={b.id === hiddenId ? depth : depth + 1}
            go={go}
            counts={counts}
          />
        );
        if (b.id === hiddenId) return <div key={b.id}>{below}</div>;
        const size = counts.get(b.id)?.elementCount || undefined;
        return (
          <div key={b.id}>
            <NavItem
              icon={b.kind === 'storyboard' ? 'storyboard' : 'board'}
              contentKind={b.kind}
              label={b.title}
              count={size}
              title={size ? `${b.title} · ${t('nav.items', { count: size })}` : undefined}
              href={`/p/${projectId}/b/${b.id}`}
              active={b.id === activeId}
              onClick={go(`/p/${projectId}/b/${b.id}`)}
              style={{ paddingLeft: 8 + depth * 14 }}
            />
            {below}
          </div>
        );
      })}
    </>
  );
}

const COLLAPSED_KEY = 'inkadra.sidebar.collapsed';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(value: boolean) {
  try {
    if (value) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** Element and frame counts of the open project's boards; refreshed when its boards change. */
function useBoardCounts(
  projectId: string | undefined,
  boards: readonly Board[] | null | undefined,
): Map<string, BoardCount> {
  const [counts, setCounts] = useState<Map<string, BoardCount>>(new Map());
  // Any board edit moves its editedAt, so the newest one tells when to count again.
  const stamp = boards
    ?.map((b) => b.editedAt ?? '')
    .sort()
    .at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp is the refresh signal.
  useEffect(() => {
    if (!projectId) {
      setCounts(new Map());
      return;
    }
    let live = true;
    api
      .get<{ items: BoardCount[] }>(`/projects/${projectId}/board-counts`)
      .then((r) => {
        if (!live) return;
        const next = new Map(r.items.map((c) => [c.boardId, c]));
        setCounts(next);
        forgetSeededCounts(next);
      })
      .catch(() => {
        // Counts are a hint; the navigation works without them.
      });
    return () => {
      live = false;
    };
  }, [projectId, stamp, boards?.length]);
  // Boards laid out in the background (the Canvas menu) are counted as soon as they are seeded.
  const seeded = useSeededCounts();
  return useMemo(() => mergeSeededCounts(counts, seeded), [counts, seeded]);
}
