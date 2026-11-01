// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardVersion } from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { type MutableRefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import type { BoardStore } from './store.ts';
import { collectTrash, restoreTrashItem, type TrashItem } from './trash.ts';

type Page = { items: BoardVersion[]; nextCursor: string | null };

/** A completed scan, kept by the dialog until it closes so tab switches do not rescan. */
export type TrashScan = { boardId: string; items: TrashItem[] };

/** Snapshots fetched again for restore; a few are kept for consecutive restores. */
const RECENT = 3;

export function TrashPanel({
  boardId,
  store,
  editable,
  cache,
}: {
  boardId: string;
  store: BoardStore;
  editable: boolean;
  cache?: MutableRefObject<TrashScan | null>;
}) {
  const { t } = useTranslation();
  const reload = useRef<HTMLElement>(null);
  const live = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const cached = cache?.current?.boardId === boardId ? cache.current : null;
  const [items, setItems] = useState<TrashItem[]>(cached?.items ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [restored, setRestored] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const updates = useRef(new Map<string, Uint8Array>());
  const restoreAbort = useRef<AbortController | null>(null);
  useEffect(() => () => restoreAbort.current?.abort(), []);
  useEffect(() => {
    setRestored(false);
    setError(false);
    if (revision === 0 && cache?.current?.boardId === boardId) {
      setItems(cache.current.items);
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    const { signal } = abort;
    setItems([]);
    setLoading(true);
    const load = async () => {
      const found = new Map<string, TrashItem>();
      const isLive = (id: string) => store.getSnapshot().byId.has(id);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const base = `/boards/${boardId}/versions`;
      let cursor: string | null = null;
      scan: do {
        const page: Page = await api.get<Page>(
          `${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          signal,
        );
        if (signal.aborted) return;
        for (const version of page.items) {
          if (Date.parse(version.createdAt) < cutoff) break scan;
          const update = await api.bytes(`${base}/${version.id}/state`, signal);
          if (signal.aborted) return;
          collectTrash(found, version, update, boardId, isLive);
          setItems([...found.values()]);
        }
        cursor = page.nextCursor;
      } while (cursor);
      if (cache) cache.current = { boardId, items: [...found.values()] };
    };
    void load()
      .catch(() => {
        if (!signal.aborted) setError(true);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [boardId, revision, store, cache]);
  const snapshot = async (versionId: string, signal: AbortSignal) => {
    const recent = updates.current;
    let update = recent.get(versionId);
    if (update) recent.delete(versionId);
    else update = await api.bytes(`/boards/${boardId}/versions/${versionId}/state`, signal);
    recent.set(versionId, update);
    for (const key of recent.keys()) {
      if (recent.size <= RECENT) break;
      recent.delete(key);
    }
    return update;
  };
  const deleted = items.filter(({ element }) => !live.byId.has(element.id));
  return (
    <section ref={reload} aria-label={t('trash.title')}>
      <p className="ink-muted">{t('trash.description')}</p>
      <Button onClick={() => setRevision((value) => value + 1)} disabled={loading}>
        {t('versions.reload')}
      </Button>
      {loading && <p role="status">{t('versions.loading')}</p>}
      {error && <p role="alert">{t('trash.error')}</p>}
      {restored && <p role="status">{t('trash.restored')}</p>}
      {!loading && !error && deleted.length === 0 && <p>{t('trash.empty')}</p>}
      <ul className="versions__trash-list">
        {deleted.map((item) => (
          <li className="versions__item" key={item.element.id}>
            <div className="versions__meta">
              <strong>
                {('title' in item.element && item.element.title) ||
                  ('caption' in item.element && item.element.caption) ||
                  t(`board.types.${item.element.type}`)}
              </strong>
              <span>
                {t('trash.savedAt', {
                  date: formatDateTime(item.savedAt, { dateStyle: 'short', timeStyle: 'short' }),
                })}
              </span>
              <code>{item.element.id}</code>
              {item.element.type === 'board' && <span>{t('trash.boardLinkOnly')}</span>}
            </div>
            <Button
              disabled={!editable || restoring}
              aria-label={t('trash.restoreElement', {
                type: t(`board.types.${item.element.type}`),
                id: item.element.id,
              })}
              onClick={async () => {
                const abort = new AbortController();
                restoreAbort.current = abort;
                setRestoring(true);
                try {
                  const update = await snapshot(item.versionId, abort.signal);
                  if (abort.signal.aborted) return;
                  setRestored(restoreTrashItem(store, item, update, boardId));
                  reload.current?.querySelector<HTMLButtonElement>('button')?.focus();
                } catch {
                  if (!abort.signal.aborted) setError(true);
                } finally {
                  if (!abort.signal.aborted) setRestoring(false);
                }
              }}
            >
              {t('versions.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
