import type { Board } from '@inkadra/shared';
import type { Editor } from '@tiptap/react';
import { createContext, useContext } from 'react';
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
}

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard outside BoardContext');
  return ctx;
}
