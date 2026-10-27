// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from './connection.ts';
import type { Peer } from './presence.ts';

/** What the header says about the connection: saving, saved when, or why nothing is syncing. */
export type SyncSummary =
  | { kind: 'readOnly' | 'connecting' | 'offline' | 'denied' | 'signedOut' | 'saving' }
  | { kind: 'saved'; seconds: number | null };

export interface SyncInputs {
  status: ConnectionStatus;
  readOnly: boolean;
  /** Changes this tab made that the server has not confirmed yet. */
  pending: number;
  /** When the server last confirmed a change, or null while none was sent. */
  savedAt: number | null;
}

export function syncSummary(
  { status, readOnly, pending, savedAt }: SyncInputs,
  now: number,
): SyncSummary {
  if (readOnly) return { kind: 'readOnly' };
  if (status !== 'synced') return { kind: status };
  if (pending > 0) return { kind: 'saving' };
  if (savedAt === null) return { kind: 'saved', seconds: null };
  return { kind: 'saved', seconds: Math.max(0, Math.floor((now - savedAt) / 1000)) };
}

/** Where saved changes are shown as a timer; below this the line just says "saved". */
export const FRESH_SAVE_S = 3;

/** Everyone on the board: each person once, this tab included. */
export function onlineCount(peers: readonly Peer[]): number {
  return new Set(peers.map((p) => p.user.id)).size + 1;
}

export interface Editor {
  id: string;
  name: string;
  /** What the card is called: its text, title or type. */
  label: string;
  color: string;
}

/** Who is writing in a card right now, one entry per person, by name. */
export function editingPeople(peers: readonly Peer[], labelOf: (id: string) => string): Editor[] {
  const byUser = new Map<string, Editor>();
  for (const p of peers) {
    if (!p.editing || byUser.has(p.user.id)) continue;
    byUser.set(p.user.id, {
      id: p.user.id,
      name: p.user.name,
      label: labelOf(p.editing),
      color: p.color,
    });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A clock for the saved timer; null while there is no timestamp to count from. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** "3 online · saved 12s ago": the connection, from the collaboration provider's state. */
export function SyncStatus({
  status,
  readOnly,
  pending,
  savedAt,
  online,
}: SyncInputs & { online: number }) {
  const { t } = useTranslation();
  const ticking = status === 'synced' && !readOnly && pending === 0 && savedAt !== null;
  const now = useNow(ticking);
  const summary = syncSummary({ status, readOnly, pending, savedAt }, now);
  const state =
    summary.kind === 'saved'
      ? summary.seconds === null || summary.seconds < FRESH_SAVE_S
        ? t('board.status.saved')
        : t('board.status.savedAgo', { count: summary.seconds })
      : summary.kind === 'saving'
        ? t('board.status.saving')
        : t(`board.status.${summary.kind}`);
  // The timer changes every second: it is read where it stands, not announced as a live region.
  const announcement =
    summary.kind === 'saved'
      ? t('board.status.saved')
      : summary.kind === 'saving'
        ? t('board.status.saving')
        : t(`board.status.${summary.kind}`);
  return (
    <span className={`sync sync--${summary.kind === 'saved' ? 'synced' : summary.kind}`}>
      <span className="sync__dot" aria-hidden="true" />
      <span className="sync__text">
        {status === 'synced' ? `${t('board.status.online', { count: online })} · ${state}` : state}
      </span>
      <span className="sync__announce" role="status">
        {announcement}
      </span>
    </span>
  );
}

/** "Giulia is editing Logline": the card someone else has open for writing. */
export function EditingLine({ editors }: { editors: readonly Editor[] }) {
  const { t } = useTranslation();
  if (editors.length === 0) return null;
  const [first, ...rest] = editors as [Editor, ...Editor[]];
  return (
    <span
      className="board-header-editing"
      title={editors
        .map((e) => t('board.editing.one', { name: e.name, label: e.label }))
        .join('\n')}
      style={{ ['--peer' as string]: first.color }}
    >
      <span className="sync__dot board-header-editing__dot" aria-hidden="true" />
      <span className="board-header-editing__text">
        {t('board.editing.one', { name: first.name, label: first.label })}
      </span>
      {rest.length > 0 && (
        <span className="board-header-editing__more">
          {t('board.editing.more', { count: rest.length })}
        </span>
      )}
    </span>
  );
}
