import type {
  CommentCount,
  GuestAsset,
  GuestElementReview,
  GuestPick,
  GuestSetElementReview,
  SetPick,
} from '@inkadra/shared';
import { createContext, useContext } from 'react';
import type { Rights } from './model.ts';

/** What the parts of the guest page share: the snapshot's state and the guest's actions. */
export interface GuestActions {
  linkId: string;
  boardId: string;
  rights: Rights;
  guestName: string | null;
  version: string;
  assets: ReadonlyMap<string, GuestAsset>;
  picks: ReadonlyMap<string, GuestPick>;
  reviews: ReadonlyMap<string, GuestElementReview>;
  counts: ReadonlyMap<string | null, CommentCount>;
  pick: (elementId: string, body: SetPick) => Promise<void>;
  review: (elementId: string, body: GuestSetElementReview) => Promise<boolean>;
  /** Runs an action that needs the guest's name, asking for it first if it is missing. */
  withName: (action: () => Promise<unknown> | unknown) => void;
  /** Reads the snapshot again after a change. */
  refresh: () => void;
  /** Turns a failed request into the right page state; returns a message to show, if any. */
  fail: (err: unknown) => string | null;
  select: (elementId: string | null) => void;
  view: (elementId: string) => void;
  /** A short message for the guest, read out by screen readers. */
  notify: (message: string | null) => void;
  notice: string | null;
}

export const GuestActionsContext = createContext<GuestActions | null>(null);

export function useGuestActions(): GuestActions {
  const ctx = useContext(GuestActionsContext);
  if (!ctx) throw new Error('useGuestActions outside GuestActionsContext');
  return ctx;
}
