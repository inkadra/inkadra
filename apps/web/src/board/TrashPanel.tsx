// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardVersion } from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import type { BoardStore } from './store.ts';
import { collectTrash, restoreTrashItem, type TrashItem } from './trash.ts';

type Page = { items: BoardVersion[]; nextCursor: string | null };

export function TrashPanel({
  boardId,
  store,
  editable,
}: {
  boardId: string;
  store: BoardStore;
  editable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const reload = useRef<HTMLElement>(null);
  const live = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void revision;
    let active = true;
    setItems([]);
    setLoading(true);
    setError(false);
    const load = async () => {
      const found = new Map<string, TrashItem>();
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const base = `/boards/${boardId}/versions`;
      let cursor: string | null = null;
      do {
        const page: Page = await api.get<Page>(
          `${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        if (!active) return;
        for (const version of page.items) {
          if (Date.parse(version.createdAt) < cutoff) return;
          const update = await api.bytes(`${base}/${version.id}/state`);
          if (!active) return;
          collectTrash(found, version, update, boardId);
          setItems([...found.values()]);
        }
        cursor = page.nextCursor;
      } while (active && cursor);
    };
    void load()
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [boardId, revision]);
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
                {t('trash.savedAt', { date: new Date(item.savedAt).toLocaleString(i18n.language) })}
              </span>
              <code>{item.element.id}</code>
              {item.element.type === 'board' && <span>{t('trash.boardLinkOnly')}</span>}
            </div>
            <Button
              disabled={!editable}
              aria-label={t('trash.restoreElement', {
                type: t(`board.types.${item.element.type}`),
                id: item.element.id,
              })}
              onClick={() => {
                try {
                  setRestored(restoreTrashItem(store, item, boardId));
                  reload.current?.querySelector<HTMLButtonElement>('button')?.focus();
                } catch {
                  setError(true);
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
