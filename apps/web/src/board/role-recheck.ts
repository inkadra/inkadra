import { useEffect, useState } from 'react';
import type { BoardConnection } from './connection.ts';

/**
 * Goes up each time the role read for the page must be read again: the server gave this
 * connection write access that role does not allow. The page reads the role before the socket
 * authenticates, so a promotion in between reaches no open connection and sends no `access`
 * message (decision 0011). Only that direction: the server also gives editors a read-only
 * connection (a frozen board, a newer schema), which says nothing about the role.
 */
export function useRoleRecheck(
  conn: Pick<BoardConnection, 'status' | 'readOnly'> | null,
  /** Whether the role read for the page allows editing; null before it is read. */
  roleCanEdit: boolean | null,
) {
  const stale = conn?.status === 'synced' && !conn.readOnly && roleCanEdit === false;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (stale) setVersion((v) => v + 1);
  }, [stale]);
  return version;
}
