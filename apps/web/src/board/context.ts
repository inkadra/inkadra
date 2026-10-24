import type { Element } from '@inkadra/doc-schema';
import type { Board } from '@inkadra/shared';
import type { Editor } from '@tiptap/react';
import { createContext, type ReactNode, useContext } from 'react';
import type { BoardStore } from './store.ts';

export interface BoardContextValue {
  store: BoardStore;
  readOnly: boolean;
  projectId: string;
  boardId: string;
  userId: string;
  /** Boards of the project, for the titles of board cards. */
  boards: Board[] | null;
  /** Zoom rounded to a power of two, to pick image sizes without re-rendering on every step. */
  scale: number;
  editing: string | null;
  setEditing: (id: string | null) => void;
  openBoard: (boardId: string) => void;
  setNoteEditor: (editor: Editor | null) => void;
  /** Shot number of each frame, from the scenes it sits in. */
  frameLabels: ReadonlyMap<string, string>;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

/**
 * True on the guest page of a share link: guests do not receive internal fields (decision
 * 0013), so cards leave out what would otherwise show as a default, such as a frame's
 * production status.
 */
export const GuestModeContext = createContext(false);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard outside BoardContext');
  return ctx;
}

/** Extra controls a page draws on each card, such as the picks of the guest page. */
export const CardExtrasContext = createContext<((element: Element) => ReactNode) | null>(null);
