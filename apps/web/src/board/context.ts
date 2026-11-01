import type { Element } from '@inkadra/doc-schema';
import type { Board, BoardCount } from '@inkadra/shared';
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
  /** What each board holds, for the counts on board cards; not for guests. */
  boardCounts?: ReadonlyMap<string, BoardCount>;
  /** Zoom rounded to a power of two, to pick image sizes without re-rendering on every step. */
  scale: number;
  /** Many cards: pictures keep their poster until they are hovered or selected. */
  largeBoard: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
  cropping?: string | null;
  setCropping?: (id: string | null) => void;
  openElement?: (element: Element) => void;
  openBoard: (boardId: string) => void;
  setNoteEditor: (editor: Editor | null) => void;
  /** Shot number of each frame, from the scenes it sits in. */
  frameLabels: ReadonlyMap<string, string>;
  /** Credit of the map data on map pictures (Instance.maps). */
  mapAttribution?: string | undefined;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

/**
 * Cards beyond which a board counts as large for pictures: GIFs then keep their poster
 * until the card is hovered or selected, instead of all playing at once.
 */
export const LARGE_BOARD = 60;

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
