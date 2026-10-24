import type { HocuspocusProvider } from '@hocuspocus/provider';
import { readBoardNotice } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { Toast } from './chrome.tsx';
import type { BoardStore } from './store.ts';

export function RestoredToast({
  provider,
  boardId,
  store,
  canList,
}: {
  provider: HocuspocusProvider;
  boardId: string;
  store: BoardStore;
  canList: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const close = useCallback(() => setText(null), []);
  useEffect(() => {
    let generation = 0;
    const onNotice = async ({ payload }: { payload: string }) => {
      const notice = readBoardNotice(payload);
      if (notice?.type !== 'restored') return;
      const token = ++generation;
      // Undo must never replay edits made against the state before a server-side restore.
      store.undo.clear();
      setText(t('versions.restoredGeneric'));
      if (!canList) return;
      try {
        let cursor: string | null = null;
        do {
          const page: { items: BoardVersion[]; nextCursor: string | null } = await api.get(
            `/boards/${boardId}/versions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          if (token !== generation) return;
          const version = page.items.find((v) => v.id === notice.versionId);
          if (version) {
            setText(
              t('versions.restored', {
                version:
                  version.name ??
                  new Date(version.createdAt).toLocaleString(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
              }),
            );
            return;
          }
          cursor = page.nextCursor;
        } while (cursor);
      } catch {
        /* The restore still succeeded if metadata is no longer accessible. */
      }
    };
    provider.on('stateless', onNotice);
    return () => {
      generation++;
      provider.off('stateless', onNotice);
    };
  }, [provider, boardId, store, canList, t, i18n.language]);
  return text ? <Toast text={text} onClose={close} /> : null;
}
