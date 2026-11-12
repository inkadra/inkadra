// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { type BoardConnection, useBoardConnection } from '../connection.ts';

/** Opens one board's document for the schedule, and says when it is open or refused. */
export default function SourceDoc({
  boardId,
  onConn,
}: {
  boardId: string;
  onConn: (boardId: string, conn: BoardConnection | null) => void;
}) {
  const conn = useBoardConnection(boardId, false);
  useEffect(() => {
    onConn(boardId, conn);
  }, [boardId, conn, onConn]);
  useEffect(() => () => onConn(boardId, null), [boardId, onConn]);
  return null;
}
