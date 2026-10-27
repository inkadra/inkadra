import type { HocuspocusProvider } from '@hocuspocus/provider';
import { readBoardNotice } from '@inkadra/doc-schema';
import type { BoardVersion, RestoredBoardVersion } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type SyntheticEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { isTyping } from './shortcuts.ts';
import type { BoardStore } from './store.ts';
import { TrashPanel, type TrashScan } from './TrashPanel.tsx';
import {
  groupVersions,
  mergeVersions,
  type VersionAction,
  versionError,
  versionStore,
} from './versions.ts';
import './versions.css';

type VersionPage = { items: BoardVersion[]; nextCursor: string | null };
export type VersionPreview = { version: BoardVersion; store: BoardStore };

export function VersionsDialog({
  open,
  boardId,
  provider,
  store,
  editable,
  onClose,
  preview,
  onPreview,
  onRestored,
}: {
  open: boolean;
  boardId: string;
  provider: HocuspocusProvider;
  store: BoardStore;
  editable: boolean;
  onClose: () => void;
  preview: VersionPreview | null;
  onPreview: (value: VersionPreview | null) => void;
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tabsId = useId();
  const [tab, setTab] = useState<'versions' | 'trash'>('versions');
  // Kept for the dialog session only: closing drops the scan and its elements.
  const trashScan = useRef<TrashScan | null>(null);
  useEffect(() => {
    if (!open) trashScan.current = null;
  }, [open]);
  const [page, setPage] = useState<VersionPage | null>(null);
  const [revision, setRevision] = useState(0);
  const loadedCount = useRef(0);
  loadedCount.current = page?.items.length ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<BoardVersion | null>(null);
  const [confirm, setConfirm] = useState<{
    version: BoardVersion;
    action: 'restore' | 'delete';
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  const confirmOpen = useRef(false);
  confirmOpen.current = confirm !== null;
  const bannerFocused = useRef<string | null>(null);
  const banner = useRef<HTMLElement>(null);
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
      // Reconcile all loaded pages, including deletions, without losing "load more" results.
      const count = loadedCount.current;
      while (next.nextCursor && next.items.length < count) {
        if (!alive.current || token !== generation.current) return;
        const more = await api.get<VersionPage>(
          `${base}?cursor=${encodeURIComponent(next.nextCursor)}`,
        );
        next.items = mergeVersions(next.items, more.items);
        next.nextCursor = more.nextCursor;
      }
      if (alive.current && token === generation.current) {
        setPage(next);
        // Fresh metadata cannot establish whether an unconfirmed mutation succeeded.
        setLoadError(null);
      }
    } catch (err) {
      if (alive.current && token === generation.current) setLoadError(fail(err));
    }
  }, [base, fail]);
  useEffect(() => {
    void revision;
    if (open && !busy) void load();
  }, [open, load, revision, busy]);
  useEffect(() => {
    const onNotice = ({ payload }: { payload: string }) => {
      const notice = readBoardNotice(payload);
      if (notice?.type === 'versions' || notice?.type === 'restored') {
        // Invalidate any in-flight list before scheduling a fresh read.
        generation.current++;
        setRevision((value) => value + 1);
      }
    };
    provider.on('stateless', onNotice);
    return () => {
      provider.off('stateless', onNotice);
    };
  }, [provider]);
  const merge = (changed: BoardVersion[], removed: string[] = []) =>
    setPage((p) => p && { ...p, items: mergeVersions(p.items, changed, removed) });
  // The versions dialog is modal until its own effect closes it: focus the banner only afterwards.
  const previewId = preview?.version.id ?? null;
  useEffect(() => {
    if (!previewId) bannerFocused.current = null;
    if (!previewId || open || bannerFocused.current === previewId) return;
    bannerFocused.current = previewId;
    const frame = requestAnimationFrame(() => banner.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [previewId, open]);
  // Escape leaves the preview when nothing else on the page takes it. The listener covers the whole
  // preview, not only the frames after React committed the panel closed: the browser closes the
  // panel's dialog as soon as Escape arrives, so a second Escape in that gap must not be lost. An
  // open panel or confirmation still wins, because the handler leaves a popup's Escape to the popup.
  useEffect(() => {
    if (previewId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target)) return;
      const popups = 'dialog[open], [role="menu"], [role="dialog"], [aria-modal="true"]';
      if (document.querySelector(popups)) return;
      if (e.target instanceof Element && e.target.closest(popups)) return;
      e.preventDefault();
      onPreview(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewId, onPreview]);
  // While a request runs, Escape must not close a dialog whose result is still pending.
  const holdWhileBusy = (e: SyntheticEvent<HTMLDialogElement>) => {
    if (locked.current) e.preventDefault();
  };
  const closeConfirm = () => {
    setConfirm(null);
    setConfirmError(null);
  };
  const openConfirm = (version: BoardVersion, action: 'restore' | 'delete') => {
    setConfirmError(null);
    setConfirm({ version, action });
  };
  // Every action is single-flight, including rapid double clicks before React renders.
  async function run(kind: VersionAction, action: () => Promise<void>, confirmation = false) {
    if (locked.current || (!editable && kind !== 'read' && kind !== 'preview')) return;
    locked.current = true;
    generation.current++;
    setBusy(true);
    setError(null);
    setConfirmError(null);
    try {
      await action();
    } catch (err) {
      // The browser may still have closed the confirmation: then the error belongs to the list.
      if (alive.current)
        (confirmation && confirmOpen.current ? setConfirmError : setError)(fail(err, kind));
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
      <Dialog open={open} title={t('versions.title')} onCancel={holdWhileBusy} onClose={onClose}>
        <div className="versions" aria-busy={busy}>
          <div className="versions__tabs" role="tablist" aria-label={t('versions.title')}>
            {(['versions', 'trash'] as const).map((value) => (
              <Button
                key={value}
                id={`${tabsId}-${value}`}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`${tabsId}-panel`}
                tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'versions'
                      : event.key === 'End'
                        ? 'trash'
                        : value === 'versions'
                          ? 'trash'
                          : 'versions';
                  setTab(next);
                  document.getElementById(`${tabsId}-${next}`)?.focus();
                }}
              >
                {t(value === 'versions' ? 'trash.versions' : 'trash.title')}
              </Button>
            ))}
          </div>
          <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
            {tab === 'trash' ? (
              // The Dialog keeps its children mounted while closed: mount the panel only while
              // it is visible, so closing aborts the scan.
              open && (
                <TrashPanel boardId={boardId} store={store} editable={editable} cache={trashScan} />
              )
            ) : (
              <>
                <p className="ink-muted">{t('versions.description')}</p>
                {editable && (
                  <form
                    className="versions__save"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!name.trim()) return;
                      void run(editing ? 'rename' : 'save', async () => {
                        const saved = editing
                          ? await api.patch<BoardVersion>(`${base}/${editing.id}`, {
                              name: name.trim(),
                            })
                          : await api.post<BoardVersion>(base, { name: name.trim() });
                        if (!alive.current) return;
                        setName('');
                        setEditing(null);
                        if (page) merge([saved]);
                        else await load();
                      });
                    }}
                  >
                    <TextField
                      label={editing ? t('versions.renameField') : t('versions.name')}
                      value={name}
                      maxLength={120}
                      required
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                      {t(editing ? 'versions.renameSubmit' : 'versions.save')}
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
                )}
                {(error || loadError) && (
                  <p role="alert">
                    {error ?? loadError}{' '}
                    <Button disabled={busy} onClick={() => void load()}>
                      {t('versions.reload')}
                    </Button>
                  </p>
                )}
                {!page && !error && !loadError && <p role="status">{t('versions.loading')}</p>}
                {page?.items.length === 0 && <p className="ink-muted">{t('versions.empty')}</p>}
                <div className="versions__list">
                  {groupVersions(page?.items ?? []).map((group) => (
                    <section
                      key={group.day.toDateString()}
                      aria-label={group.day.toLocaleDateString(i18n.language, {
                        dateStyle: 'full',
                      })}
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
                              {editable && (
                                <>
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
                                  <Button disabled={busy} onClick={() => openConfirm(v, 'restore')}>
                                    {t('versions.restore')}
                                  </Button>
                                  <Button disabled={busy} onClick={() => openConfirm(v, 'delete')}>
                                    {t('versions.delete')}
                                  </Button>
                                </>
                              )}
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
                        // A reload started meanwhile replaces the list: this page is then stale.
                        const token = generation.current;
                        const next = await api.get<VersionPage>(
                          `${base}?cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
                        );
                        if (alive.current && token === generation.current)
                          setPage(
                            (p) =>
                              p && {
                                items: mergeVersions(p.items, next.items),
                                nextCursor: next.nextCursor,
                              },
                          );
                      })
                    }
                  >
                    {t('versions.more')}
                  </Button>
                )}
              </>
            )}
          </div>
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>
              {t('versions.close')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
      {preview && (
        <section className="version-banner" aria-label={t('versions.preview')}>
          <strong tabIndex={-1} ref={banner}>
            {t('versions.banner', { date: date(preview.version) })}
          </strong>
          {preview.version.name && <span>{preview.version.name}</span>}
          <span className="ink-muted">{t('versions.readOnly')}</span>
          {editable && (
            <Button variant="primary" onClick={() => openConfirm(preview.version, 'restore')}>
              {t('versions.restore')}
            </Button>
          )}
          <Button onClick={() => onPreview(null)}>{t('versions.close')}</Button>
        </section>
      )}
      <Dialog
        open={confirm !== null}
        title={t(confirm?.action === 'delete' ? 'versions.deleteTitle' : 'versions.restoreTitle')}
        onCancel={holdWhileBusy}
        onClose={closeConfirm}
      >
        <p>{confirm && title(confirm.version)}</p>
        <p>{t(confirm?.action === 'delete' ? 'versions.deleteBody' : 'versions.restoreBody')}</p>
        {confirmError && <p role="alert">{confirmError}</p>}
        <DialogActions>
          <Button disabled={busy} onClick={closeConfirm}>
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
                  const { version, action } = confirm;
                  if (action === 'delete') {
                    await api.delete(`${base}/${version.id}`);
                    if (!alive.current) return;
                    merge([], [version.id]);
                  } else {
                    const result = await api.post<RestoredBoardVersion>(
                      `${base}/${version.id}/restore`,
                      {},
                    );
                    onRestored();
                    if (!alive.current) return;
                    merge([result.restored, result.backup]);
                  }
                  closeConfirm();
                  // A preview of the old board, or of a deleted version, is stale now.
                  if (preview && (action === 'restore' || preview.version.id === version.id))
                    onPreview(null);
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
