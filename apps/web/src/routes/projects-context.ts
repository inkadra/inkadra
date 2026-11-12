import type { Board, BoardCount, Project } from '@inkadra/shared';
import { createContext, useContext } from 'react';
import type { InboxFilter } from '../notifications/model.ts';

export interface ProjectsState {
  projects: Project[] | null;
  shared: Board[] | null;
  /** Opens New project, optionally into a group. */
  openNewProject: (groupId?: string) => void;
  /** Opens Import project… (decision 0037). */
  openImportProject: () => void;
  /** False when an administrator keeps project creation to some people (decision 0041). */
  canCreateProjects: boolean;
  openSearch: () => void;
  /** Opens the Inbox, on one of its tabs (the Home's See all opens Tasks). */
  openInbox: (filter?: InboxFilter) => void;
  unread: number;
  refreshUnread: () => Promise<void>;
  /** Counts of the open project's boards, which choose the views of boards from before 0121. */
  boardCounts: ReadonlyMap<string, BoardCount>;
}

export const ProjectsContext = createContext<ProjectsState>({
  projects: null,
  shared: null,
  openNewProject: () => {},
  openImportProject: () => {},
  canCreateProjects: true,
  openSearch: () => {},
  openInbox: () => {},
  unread: 0,
  refreshUnread: async () => {},
  boardCounts: new Map(),
});
export const useProjects = () => useContext(ProjectsContext);
