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
  Select,
  Sidebar,
  SidebarSection,
} from '@inkadra/ui';
import {
  createContext,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
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
import {
  childBoards,
  hasListedBoards,
  useProjectBoards,
  useSharedBoards,
} from '../board/boards.ts';
import { useBoardCounts } from '../board/live-counts.ts';
import {
  ALL_FILM_LINKS,
  askedView,
  type BoardView,
  clientReviewBoard,
  defaultView,
  type FilmLinks,
  filmLinks,
  isBoardView,
  isFilmView,
  pickerViews,
  projectHasStoryboard,
  storyboardOf,
  viewDestination,
  viewHref,
  viewIcon,
} from '../board/views.ts';
import { appActions } from '../commands/app-actions.ts';
import { canCreateProjects } from '../lib/access.ts';
import { authApi } from '../lib/api.ts';
import { HeaderContext, type HeaderParts } from '../lib/header.tsx';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';
import {
  NotificationBell,
  NotificationList,
  useNotificationFeed,
  useUnreadCount,
} from '../notifications/Notifications.tsx';
import { addStoryboardItem } from './add-storyboard.ts';
import { editableProjects } from './home-data.ts';
import { useInstanceSetup } from './InstanceSetup.tsx';
import { MobileNavigation } from './MobileNavigation.tsx';
import { NewBoardDialog } from './NewBoardDialog.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { ProjectNavItem } from './ProjectAppearance.tsx';
import { SidebarGroup, useDropTarget } from './ProjectGroups.tsx';
import { ImportProjectDialog } from './ProjectTransfer.tsx';
import { groupProjects, moveToGroup, useProjectGroups } from './project-groups.ts';
import { onboardingTitle, type ProjectTemplate } from './project-setup.ts';
import {
  getCachedProjects,
  refreshProjects,
  setCachedProjects,
  subscribeProjects,
} from './projects.ts';
import { SearchDialog } from './SearchDialog.tsx';
import { SettingsWindow } from './SettingsWindow.tsx';
import { SeedQueue } from './seed-queue.tsx';
import { isSettingsPath } from './settings-sections.ts';
import './mobile-shell.css';

interface ProjectsState {
  projects: Project[] | null;
  shared: Board[] | null;
  /** Opens New project, optionally with a template already chosen, or into a group. */
  openNewProject: (template?: ProjectTemplate, groupId?: string) => void;
  /** Opens Import project… (decision 0037). */
  openImportProject: () => void;
  /** False when an administrator keeps project creation to some people (decision 0041). */
  canCreateProjects: boolean;
  openSearch: () => void;
  openInbox: () => void;
  unread: number;
  refreshUnread: () => Promise<void>;
  /** The film links of the open project: what the sidebar, the header tabs and the phone offer. */
  filmLinks: FilmLinks;
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
  filmLinks: ALL_FILM_LINKS,
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
  const groups = useProjectGroups(!!user);
  const grouped = groupProjects(projects ?? [], groups, (p) => p);
  // Dropped on the Projects heading, a project leaves its group.
  const looseDrop = useDropTarget('loose', (id) => void moveToGroup(id, null).catch(() => {}));
  // The group a project made from a group's menu goes into.
  const newProjectGroup = useRef<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A template when New project opens with one preselected, as from Home.
  const [creating, setCreating] = useState<boolean | ProjectTemplate>(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [importing, setImporting] = useState(false);
  // The project a new board goes into when it starts from inside that project.
  const [boardProject, setBoardProject] = useState<string | undefined>();
  const [newSheet, setNewSheet] = useState(false);
  const [headerContent, setHeaderContent] = useState<HeaderParts | null>(null);
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

  // Remembered per person on this device (#333).
  const userId = user?.id;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(userId));
  useEffect(() => setCollapsed(readCollapsed(userId)), [userId]);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeCollapsed(userId, !c);
      return !c;
    });
  const peek = useSidebarPeek(collapsed || inboxOpen);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // A peek lays the page out as with the navigation open, so what sits beside it moves aside
  // in step instead of being covered; over the Inbox it stays a layer above it.
  const shellCollapsed = inboxOpen || (collapsed && !peek.shown);
  const sliding = useSlide(shellCollapsed);
  // ⌘\ / Ctrl+\ folds the navigation column to its icons and back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => {
          writeCollapsed(userId, !c);
          return !c;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [userId]);

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

  const openNewProject = (template?: ProjectTemplate, groupId?: string) => {
    if (!canCreate) return;
    newProjectGroup.current = groupId;
    setDrawerOpen(false);
    setCreating(template ?? true);
  };

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
  // Without a storyboard, Review opens the board that has a live client review link.
  const reviewBoardId = clientReviewBoard(projectBoards, counts);
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
      reviewBoardId,
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
  // The film links appear with the project's first storyboard (or frame) and while a film view is
  // open, so there is always a way back; until the boards are known they stay out.
  // One rule for the sidebar, the header tabs and the phone switcher (BoardPage reads it here).
  const links = filmLinks(projectHasStoryboard(projectBoards, counts), reviewBoardId, currentView);
  const showFilmLinks = links.film;
  const showReview = links.review;
  const filmRowActive = (v: BoardView) =>
    currentView === v ||
    (v === 'storyboard' && !filmView && !!storyboardId && openBoardId === storyboardId);

  const renderProject = (p: Project, onDropProject?: (id: string, after: boolean) => void) => (
    <div key={p.id} className={p.id === projectId ? undefined : 'ink-sidebar__collapsible'}>
      <ProjectNavItem
        project={p}
        onDropProject={onDropProject}
        extra={addStoryboardItem(p, t, user.id, (to) => {
          setDrawerOpen(false);
          navigate(to);
        })}
        active={p.id === projectId && !boardId && !filmView}
        onClick={go(`/p/${p.id}`)}
      />
      {p.id === projectId && (
        <div className="ink-sidebar__modules">
          {showFilmLinks && (
            <>
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
            </>
          )}
          {showReview && (
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
          )}
          <ProjectBoards
            projectId={p.id}
            rootBoardId={p.rootBoardId}
            activeId={boardId}
            hiddenId={storyboardId}
            go={go}
            counts={counts}
            onNewBoard={
              writable.some((w) => w.id === p.id)
                ? () => {
                    setBoardProject(p.id);
                    setCreatingBoard(true);
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );

  const sidebar = (
    <Sidebar label={t('nav.navigation')} {...peek.panel}>
      <div className="ink-sidebar__workspace">
        <Logo />
        <span className="ink-nav__name" style={{ flex: 1 }}>
          {instance?.name}
        </span>
        <IconButton
          className={`ink-sidebar__toggle${collapsed ? ' is-collapsed' : ''}`}
          icon="splitPanel"
          label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          aria-expanded={!(collapsed || inboxOpen)}
          disabled={inboxOpen}
          onClick={() => {
            peek.hide();
            const collapsing = !collapsed;
            toggleCollapsed();
            // The panel shrinks into the logo button: the focus goes there with it.
            if (collapsing) requestAnimationFrame(() => launcherRef.current?.focus());
          }}
        />
      </div>
      <button
        type="button"
        className="ink-sidebar__search"
        aria-label={t('nav.search')}
        data-ink-tooltip={t('nav.search')}
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
      <div className="ink-sidebar__scroll">
        <div
          className={looseDrop.isOver ? 'project-group-loose is-drop' : 'project-group-loose'}
          {...looseDrop.props}
        >
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
        </div>
        {grouped.loose.map((p) =>
          renderProject(p, (id) => void moveToGroup(id, null).catch(() => {})),
        )}
        {grouped.groups.map(({ group, items }) => (
          <SidebarGroup
            key={group.id}
            group={group}
            groups={groups}
            count={items.length}
            onNewProject={canCreate ? () => openNewProject(undefined, group.id) : undefined}
          >
            {items
              // A folded group still shows the open project, with its boards.
              .filter((p) => !group.collapsed || p.id === projectId)
              .map((p, i, shown) =>
                renderProject(p, (id, after) => {
                  const next = after ? shown.slice(i + 1).find((o) => o.id !== id) : p;
                  void moveToGroup(id, group.id, next?.id).catch(() => {});
                }),
              )}
          </SidebarGroup>
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
      </div>
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

  // Home creates from the header only; search stays in the sidebar and on ⌘K.
  const homeActions = (
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
  );

  // The logo at the top left never moves (#333): open, it is the navigation's logo; collapsed,
  // the panel shrinks into it and it is the button that brings the navigation back.
  const launcher = (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="ink-shell__launcher"
        {...(shellCollapsed
          ? { 'aria-label': t('nav.expand'), 'data-ink-tooltip': t('nav.expand') }
          : { 'aria-hidden': true, tabIndex: -1 })}
        aria-expanded={false}
        onClick={() => {
          if (!shellCollapsed) return;
          peek.hide();
          if (inboxOpen) setInboxOpen(false);
          if (collapsed) toggleCollapsed();
          // The button is only the logo now: the focus goes to the panel's own toggle.
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>('.ink-shell > .ink-sidebar .ink-sidebar__toggle')
              ?.focus(),
          );
        }}
      >
        <Logo size={26} />
      </button>
      {(collapsed || inboxOpen) && (
        <div className="ink-shell__edge" aria-hidden="true" {...peek.edge} />
      )}
    </>
  );

  const header = (
    <Header>
      <div className="mobile-header-actions">
        {/* The drawer opens from Projects in the bottom bar, not from here as well. */}
        {projectId && (
          <IconButton
            className="mobile-back"
            icon="chevronRight"
            label={t('mobile.back')}
            onClick={() => navigate(boardId ? `/p/${projectId}` : '/')}
          />
        )}
      </div>
      <div className="shell-header-content">
        <div className="ink-header__group ink-header__start">
          {headerContent?.start ?? (
            <nav aria-label={t('nav.breadcrumb')} className="ink-header__crumbs">
              <span style={{ fontWeight: 600 }}>
                {current?.name ??
                  (pathname === '/onboarding'
                    ? onboardingCrumb && t(onboardingCrumb)
                    : t(pathname === '/projects' ? 'nav.projects' : 'nav.home'))}
              </span>
            </nav>
          )}
        </div>
        <div className="ink-header__group ink-header__end">
          {headerContent ? headerContent.end : pathname === '/' && homeActions}
          <NotificationBell
            unread={unread}
            onCount={refreshUnread}
            feed={notifications}
            onOpenInbox={(opener) => {
              inboxOpener.current = opener;
              setInboxOpen(true);
            }}
          />
        </div>
      </div>
      {projectId && (
        <div className="mobile-view-picker">
          <Icon
            name={viewIcon(currentView ?? defaultView(openKind))}
            contentKind={currentView ?? defaultView(openKind)}
            size={18}
          />
          <Select
            variant="quiet"
            className="mobile-view-switcher"
            aria-label={t('film.views.label')}
            value={currentView ?? ''}
            onChange={(e) => showView(e as BoardView)}
          >
            {pickerViews(openKind, currentView, links).map((v) => (
              <option key={v} value={v}>
                {t(`film.views.${v}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Header>
  );

  return (
    <InstanceSetupContext.Provider value={setup}>
      <ProjectsContext.Provider
        value={{
          projects,
          shared,
          openNewProject,
          openImportProject: () => canCreate && setImporting(true),
          canCreateProjects: canCreate,
          openSearch: () => setSearching(true),
          openInbox: () => setInboxOpen(true),
          unread,
          refreshUnread,
          filmLinks: links,
        }}
      >
        <HeaderContext.Provider value={setHeaderContent}>
          <AppShell
            launcher={launcher}
            sidebar={sidebar}
            header={header}
            // A board's own canvas runs edge to edge; its other views sit in a surface.
            canvas={!!projectId && (currentView === 'canvas' || currentView === null)}
            collapsed={shellCollapsed}
            peek={peek.shown}
            sliding={sliding}
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
              <IconButton
                icon="close"
                className="mobile-drawer__close"
                label={t('mobile.close')}
                onClick={() => setDrawerOpen(false)}
              />
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
                  {t('mobile.closeSheet')}
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
          onClose={() => {
            setCreating(false);
            newProjectGroup.current = undefined;
          }}
          onImport={() => {
            setCreating(false);
            setImporting(true);
          }}
          onCreated={async (p) => {
            setCreating(false);
            const group = newProjectGroup.current;
            newProjectGroup.current = undefined;
            await refreshProjects();
            if (group) await moveToGroup(p.id, group).catch(() => {});
            navigate(`/p/${p.id}`);
          }}
        />
        {canCreate && importing && <ImportProjectDialog onClose={() => setImporting(false)} />}
        <SeedQueue />
      </ProjectsContext.Provider>
    </InstanceSetupContext.Provider>
  );
}

/**
 * The Board heading and the project's boards. A project with none gets a quiet New board row
 * under the heading (nothing for a reader); until the boards are known there is no heading yet.
 */
function ProjectBoards({
  projectId,
  rootBoardId,
  activeId,
  hiddenId,
  go,
  counts,
  onNewBoard,
}: {
  projectId: string;
  rootBoardId: string;
  activeId: string | undefined;
  hiddenId: string | null;
  go: (to: string) => (e: MouseEvent) => void;
  counts: Map<string, BoardCount>;
  onNewBoard: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { items } = useProjectBoards(projectId);
  const listed = hasListedBoards(items, rootBoardId, hiddenId);
  if (!items || (!listed && !onNewBoard)) return null;
  return (
    <div className="ink-sidebar__collapsible">
      <div className="ink-sidebar__label">{t('nav.boards')}</div>
      {listed ? (
        <BoardTree
          projectId={projectId}
          parentId={rootBoardId}
          activeId={activeId}
          hiddenId={hiddenId}
          depth={1}
          go={go}
          counts={counts}
        />
      ) : (
        <NavItem
          icon="plus"
          label={t('home.newBoard.action')}
          className="ink-nav project-boards__new"
          onClick={onNewBoard}
        />
      )}
    </div>
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
/** One choice per person: the key of the device-wide choice from before #333 is the fallback. */
const collapsedKey = (userId: string | undefined) =>
  userId ? `${COLLAPSED_KEY}.${userId}` : COLLAPSED_KEY;
function readCollapsed(userId: string | undefined): boolean {
  try {
    const own = localStorage.getItem(collapsedKey(userId));
    return (own ?? localStorage.getItem(COLLAPSED_KEY)) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(userId: string | undefined, value: boolean) {
  try {
    localStorage.setItem(collapsedKey(userId), value ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** A little longer than the slide: --ink-dur-slow, after the content's fade when collapsing. */
const SLIDE_MS = 400;

/**
 * Which way the navigation is sliding, for the length of the slide: the panels beside it
 * animate from their old place to the new one with it. Set before the paint that shows the
 * new layout, so no frame has them in their new place without the animation.
 */
function useSlide(collapsed: boolean): 'out' | 'in' | null {
  const [sliding, setSliding] = useState<'out' | 'in' | null>(null);
  const was = useRef(collapsed);
  useLayoutEffect(() => {
    if (was.current === collapsed) return;
    was.current = collapsed;
    setSliding(collapsed ? 'out' : 'in');
    const timer = setTimeout(() => setSliding(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return sliding;
}

/** How long the pointer rests on the left edge before the navigation peeks out, and leaves it. */
const PEEK_IN_MS = 180;
const PEEK_OUT_MS = 320;

/**
 * The collapsed navigation shows itself over the page while a mouse rests on the window's left
 * edge, and hides again a moment after the pointer (or the focus) leaves it.
 */
function useSidebarPeek(collapsed: boolean) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(next), ms);
  };
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!collapsed) {
      clearTimeout(timer.current);
      setShown(false);
    }
  }, [collapsed]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShown(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);
  const mouse = (e: PointerEvent) => e.pointerType === 'mouse';
  return {
    shown: collapsed && shown,
    hide: () => {
      cancel();
      setShown(false);
    },
    edge: {
      onPointerEnter: (e: PointerEvent) => mouse(e) && later(true, PEEK_IN_MS),
      // Out of the edge and not into the panel (which cancels this): the peek ends.
      onPointerLeave: () => (shown ? later(false, PEEK_OUT_MS) : cancel()),
    },
    panel: collapsed
      ? {
          onPointerEnter: cancel,
          onPointerLeave: (e: PointerEvent) => mouse(e) && later(false, PEEK_OUT_MS),
          onFocus: () => {
            cancel();
            setShown(true);
          },
          onBlur: (e: FocusEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) later(false, 0);
          },
        }
      : {},
  };
}
