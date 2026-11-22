import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardConnection } from './connection.ts';

/** Waits before reading the role again after a failed read, while it still disagrees. */
const RETRY_MS = [2_000, 10_000, 30_000];

/**
 * When the page must read its role again. The key changes when the server changes this
 * connection's access, and when the server gave it write access that the role read for the page
 * does not allow: the page reads the role before the socket authenticates, so a promotion in
 * between reaches no open connection and sends no `access` message (decision 0011). Only that
 * direction: the server also gives editors a read-only connection (a frozen board, a newer
 * schema), which says nothing about the role. Both at once read the role once.
 *
 * `failed` is called when a read fails: while the role still disagrees, it reads again later
 * (a few times), since no new event may come to show the mismatch again.
 */
export function useRoleRecheck(
  conn: Pick<BoardConnection, 'status' | 'readOnly' | 'accessChangedAt'> | null,
  /** Whether the role read for the page allows editing; null before it is read. */
  roleCanEdit: boolean | null,
) {
  const stale = conn?.status === 'synced' && !conn.readOnly && roleCanEdit === false;
  const access = conn?.accessChangedAt ?? null;
  const [rechecks, setRechecks] = useState(0);
  const seenAccess = useRef(access);
  const staleNow = useRef(stale);
  staleNow.current = stale;
  const tries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const accessChanged = seenAccess.current !== access;
    seenAccess.current = access;
    tries.current = 0;
    clearTimeout(timer.current);
    // A change of access in the same render already reads the role again.
    if (stale && !accessChanged) setRechecks((v) => v + 1);
  }, [stale, access]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const failed = useCallback(() => {
    const wait = RETRY_MS[tries.current];
    if (!staleNow.current || wait === undefined) return;
    tries.current += 1;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRechecks((v) => v + 1), wait);
  }, []);
  return { key: `${access}:${rechecks}`, failed };
}
