import type { BoardVersion, RestoredBoardVersion } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import type { BoardStore } from './store.ts';
import { groupVersions, type VersionAction, versionError, versionStore } from './versions.ts';
import './versions.css';

type VersionPage = { items: BoardVersion[]; nextCursor: string | null };
export type VersionPreview = { version: BoardVersion; store: BoardStore };

export function VersionsDialog({
  open,
  boardId,
  onClose,
  preview,
  onPreview,
  onRestored,
}: {
  open: boolean;
  boardId: string;
  onClose: () => void;
  preview: VersionPreview | null;
  onPreview: (value: VersionPreview | null) => void;
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<VersionPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<BoardVersion | null>(null);
  const [confirm, setConfirm] = useState<{
    version: BoardVersion;
    action: 'restore' | 'delete';
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const base = `/boards/${boardId}/versions`;
  const fail = useCallback(
    (err: unknown, action: VersionAction = 'read') =>
      t(`versions.errors.${versionError(err, action)}`),
    [t],
  );
  const load = useCallback(async () => {
    const token = ++generation.current;
    try {
      const next = await api.get<VersionPage>(base);
      if (alive.current && token === generation.current) {
        setPage(next);
        setError(null);
      }
    } catch (err) {
      if (alive.current && token === generation.current) setError(fail(err));
    }
  }, [base, fail]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  // Every action is single-flight, including rapid double clicks before React renders.
  async function run(kind: VersionAction, action: () => Promise<void>, confirmation = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setConfirmError(null);
    try {
      await action();
    } catch (err) {
      if (alive.current) (confirmation ? setConfirmError : setError)(fail(err, kind));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const date = (v: BoardVersion) =>
    new Date(v.createdAt).toLocaleString(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const title = (v: BoardVersion) =>
    v.name ?? t(`versions.kind.${v.kind === 'restore' ? 'restore' : 'auto'}`);
  return (
    <>
      <Dialog
        open={open}
        title={t('versions.title')}
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        <div className="versions" aria-busy={busy}>
          <p className="ink-muted">{t('versions.description')}</p>
          <form
            className="versions__save"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void run(editing ? 'rename' : 'save', async () => {
                if (editing) await api.patch(`${base}/${editing.id}`, { name: name.trim() });
                else await api.post(base, { name: name.trim() });
                if (!alive.current) return;
                setName('');
                setEditing(null);
                await load();
              });
            }}
          >
            <TextField
              label={editing ? t('versions.rename') : t('versions.name')}
              value={name}
              maxLength={120}
              required
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {t(editing ? 'versions.rename' : 'versions.save')}
            </Button>
            {editing && (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setName('');
                }}
              >
                {t('versions.cancel')}
              </Button>
            )}
          </form>
          {error && (
            <p role="alert">
              {error}{' '}
              <Button disabled={busy} onClick={() => void load()}>
                {t('versions.reload')}
              </Button>
            </p>
          )}
          {!page && !error && <p role="status">{t('versions.loading')}</p>}
          {page?.items.length === 0 && <p className="ink-muted">{t('versions.empty')}</p>}
          <div className="versions__list">
            {groupVersions(page?.items ?? []).map((group) => (
              <section
                key={group.day.toDateString()}
                aria-label={group.day.toLocaleDateString(i18n.language, { dateStyle: 'full' })}
              >
                <h3>{group.day.toLocaleDateString(i18n.language, { dateStyle: 'full' })}</h3>
                <ul>
                  {group.items.map((v) => (
                    <li key={v.id} className="versions__item">
                      <div className="versions__meta">
                        <strong>{title(v)}</strong>
                        <span className="ink-muted">
                          <time dateTime={v.createdAt}>{date(v)}</time> ·{' '}
                          {t(
                            `versions.kind.${v.kind === 'named' ? 'named' : v.kind === 'restore' ? 'restore' : 'auto'}`,
                          )}
                        </span>
                        <span className="ink-muted">
                          {v.createdBy?.name ?? t('versions.automaticAuthor')} ·{' '}
                          {t('versions.elements', { count: v.elementCount })}
                        </span>
                      </div>
                      <div className="versions__actions">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run('preview', async () => {
                              const update = await api.bytes(`${base}/${v.id}/state`);
                              if (!alive.current) return;
                              const store = versionStore(update, boardId);
                              onPreview({ version: v, store });
                              onClose();
                            })
                          }
                        >
                          {t('versions.preview')}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={(e) => {
                            setEditing(v);
                            setName(v.name ?? '');
                            e.currentTarget
                              .closest('dialog')
                              ?.querySelector<HTMLInputElement>('input')
                              ?.focus();
                          }}
                        >
                          {t(v.kind === 'named' ? 'versions.rename' : 'versions.keep')}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => setConfirm({ version: v, action: 'restore' })}
                        >
                          {t('versions.restore')}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => setConfirm({ version: v, action: 'delete' })}
                        >
                          {t('versions.delete')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {page?.nextCursor && (
            <Button
              disabled={busy}
              onClick={() =>
                void run('read', async () => {
                  const next = await api.get<VersionPage>(
                    `${base}?cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
                  );
                  if (alive.current)
                    setPage({
                      items: [
                        ...page.items,
                        ...next.items.filter((v) => !page.items.some((old) => old.id === v.id)),
                      ],
                      nextCursor: next.nextCursor,
                    });
                })
              }
            >
              {t('versions.more')}
            </Button>
          )}
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>
              {t('versions.close')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
      {preview && (
        <section className="version-banner" aria-label={t('versions.preview')}>
          <strong
            tabIndex={-1}
            ref={(el) => {
              if (el && !el.dataset.focused) {
                el.dataset.focused = 'true';
                el.focus();
              }
            }}
          >
            {t('versions.banner', { date: date(preview.version) })}
          </strong>
          {preview.version.name && <span>{preview.version.name}</span>}
          <span className="ink-muted">{t('versions.readOnly')}</span>
          <Button
            variant="primary"
            onClick={() => {
              setRestorePreview(true);
              setConfirm({ version: preview.version, action: 'restore' });
            }}
          >
            {t('versions.restore')}
          </Button>
          <Button onClick={() => onPreview(null)}>{t('versions.close')}</Button>
        </section>
      )}
      <Dialog
        open={confirm !== null}
        title={t(confirm?.action === 'delete' ? 'versions.deleteTitle' : 'versions.restoreTitle')}
        onClose={() => {
          if (!busy) {
            setConfirm(null);
            setConfirmError(null);
            setRestorePreview(false);
          }
        }}
      >
        <p>{confirm && title(confirm.version)}</p>
        <p>{t(confirm?.action === 'delete' ? 'versions.deleteBody' : 'versions.restoreBody')}</p>
        {confirmError && <p role="alert">{confirmError}</p>}
        <DialogActions>
          <Button
            disabled={busy}
            onClick={() => {
              setConfirm(null);
              setConfirmError(null);
              setRestorePreview(false);
            }}
          >
            {t('versions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(
                confirm?.action ?? 'restore',
                async () => {
                  if (!confirm) return;
                  if (confirm.action === 'delete')
                    await api.delete(`${base}/${confirm.version.id}`);
                  else {
                    await api.post<RestoredBoardVersion>(
                      `${base}/${confirm.version.id}/restore`,
                      {},
                    );
                    onRestored();
                  }
                  if (!alive.current) return;
                  setConfirm(null);
                  setRestorePreview(false);
                  if (restorePreview) onPreview(null);
                  await load();
                },
                true,
              )
            }
          >
            {t(confirm?.action === 'delete' ? 'versions.delete' : 'versions.restore')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
