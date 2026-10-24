import type { HocuspocusProvider } from '@hocuspocus/provider';
import { readBoardNotice } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { Toast } from './chrome.tsx';
import type { BoardStore } from './store.ts';

/** How long the toast waits for the version name before announcing the generic text. */
const NAME_WAIT_MS = 1500;

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
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const close = useCallback(() => setNotice(null), []);
  useEffect(() => {
    let generation = 0;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const onNotice = async ({ payload }: { payload: string }) => {
      const notice = readBoardNotice(payload);
      if (notice?.type !== 'restored') return;
      const token = ++generation;
      clearTimeout(fallback);
      // Undo must never replay edits made against the state before a server-side restore.
      store.undo.clear();
      // One announcement per restore: the named text if it arrives in time, the generic one if not.
      let shown = false;
      const show = (text: string) => {
        if (shown || token !== generation) return;
        shown = true;
        clearTimeout(fallback);
        setNotice({ id: token, text });
      };
      const generic = t('versions.restoredGeneric');
      if (!canList) return show(generic);
      fallback = setTimeout(() => show(generic), NAME_WAIT_MS);
      try {
        let cursor: string | null = null;
        do {
          const page: { items: BoardVersion[]; nextCursor: string | null } = await api.get(
            `/boards/${boardId}/versions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          if (shown || token !== generation) return;
          const version = page.items.find((v) => v.id === notice.versionId);
          if (version) {
            show(
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
      show(generic);
    };
    provider.on('stateless', onNotice);
    return () => {
      generation++;
      clearTimeout(fallback);
      provider.off('stateless', onNotice);
    };
  }, [provider, boardId, store, canList, t, i18n.language]);
  // A new key per restore restarts the toast's timer.
  return notice ? <Toast key={notice.id} text={notice.text} onClose={close} /> : null;
}
