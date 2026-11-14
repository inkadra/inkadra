import { frameLabels, storyboardOf } from '@inkadra/canvas-core';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { useBoardConnection } from '../board/connection.ts';
import { plainText, useFragment } from '../board/note-text.ts';
import { type DetailProps, InboxDetailWithElement } from './InboxDetail.tsx';

export function ConnectedInboxDetail(props: DetailProps & { boardId: string }) {
  // Only observe the selected document. Never write through this connection.
  const conn = useBoardConnection(props.boardId, false);
  const snapshot = useSyncExternalStore(
    conn?.store.subscribe ?? (() => () => {}),
    conn?.store.getSnapshot ?? (() => null),
  );
  const element = snapshot?.byId.get(props.notification?.elementId ?? '');
  const label =
    element?.type === 'frame' && snapshot
      ? frameLabels(storyboardOf([...snapshot.byId.values()])).get(element.id)
      : undefined;
  const body = element?.type === 'note' ? conn?.store.map(element.id)?.get('body') : null;
  const fragment = body instanceof Y.XmlFragment ? body : null;
  useFragment(fragment);
  return (
    <InboxDetailWithElement
      {...props}
      element={element}
      elementLabel={label}
      syncing={!conn || conn.status === 'connecting'}
      excerpt={fragment ? plainText(fragment).slice(0, 240) : undefined}
    />
  );
}
