import type { TFunction } from 'i18next';
import type { PaletteAction } from './actions.ts';

/** Actions available on every page of the app; each one is offered only to those who may use it. */
export function appActions({
  t,
  admin,
  canCreateBoard,
  theme,
  navigate,
  newProject,
  newBoard,
  toggleTheme,
  openInbox,
}: {
  t: TFunction;
  admin: boolean;
  canCreateBoard: boolean;
  theme: 'light' | 'dark';
  navigate: (to: string) => void;
  /** Missing for people who cannot create projects (decision 0041). */
  newProject?: () => void;
  newBoard: () => void;
  toggleTheme: () => void;
  openInbox: () => void;
}): PaletteAction[] {
  return [
    ...(newProject ? [{ id: 'new-project', label: t('nav.newProject'), run: newProject }] : []),
    ...(canCreateBoard
      ? [{ id: 'new-board', label: t('home.newBoard.title'), run: newBoard }]
      : []),
    { id: 'home', label: t('nav.home'), run: () => navigate('/') },
    { id: 'projects', label: t('nav.projects'), run: () => navigate('/projects') },
    { id: 'settings', label: t('nav.settings'), run: () => navigate('/settings') },
    ...(admin
      ? [{ id: 'team', label: t('admin.members'), run: () => navigate('/settings/team') }]
      : []),
    {
      id: 'theme',
      label: theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark'),
      run: toggleTheme,
    },
    { id: 'inbox', label: t('nav.inbox'), run: openInbox },
  ];
}
