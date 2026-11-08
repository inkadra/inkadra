import type { MyStorage, StorageFiles } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { formatStorage } from './StorageCharts.tsx';
import { Badge, Card } from './settings-ui.tsx';
import './storage-space.css';

export type SpaceTone = 'ok' | 'warn' | 'danger';

/** Orange from the warning share chosen by the administrators, red once the limit is reached. */
export function spaceTone(used: number, limit: number | null, warnPercent: number): SpaceTone {
  if (limit === null) return 'ok';
  if (used >= limit) return 'danger';
  return used >= (limit * warnPercent) / 100 ? 'warn' : 'ok';
}

/**
 * The space bar (decision 0081): originals in full, copies and previews lighter after them.
 * A meter for assistive technology, read as "3.2 GB of 5 GB".
 */
export function SpaceMeter({
  originals,
  derived = 0,
  limit,
  tone,
  label,
  small,
}: {
  originals: number;
  derived?: number;
  limit: number;
  tone: SpaceTone;
  label: string;
  small?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const share = (bytes: number) => `${Math.min(100, Math.max(0, (bytes / limit) * 100))}%`;
  const used = originals + derived;
  return (
    <div
      className={`space-meter space-meter--${tone}${small ? ' space-meter--small' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      aria-valuetext={t('storageSpace.of', {
        used: formatStorage(used, i18n.language),
        limit: formatStorage(limit, i18n.language),
      })}
    >
      <span style={{ width: share(originals) }} />
      {derived > 0 && <span style={{ width: share(derived) }} />}
    </div>
  );
}

export function useMyStorage() {
  const [storage, setStorage] = useState<MyStorage | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<MyStorage>('/me/storage')
      .then((data) => alive && setStorage(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return storage;
}

/** "Il tuo spazio", at the top of Settings → Account. */
export function MySpaceCard() {
  const { t, i18n } = useTranslation();
  const storage = useMyStorage();
  const [files, setFiles] = useState(false);
  if (!storage) return null;
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const used = storage.originalBytes + storage.derivedBytes;
  const { limit } = storage;
  const tone = spaceTone(used, limit, storage.warnPercent);
  const badge: [SpaceTone | 'neutral', string] =
    limit === null
      ? ['neutral', t('storageSpace.unlimited')]
      : tone === 'danger'
        ? ['danger', t('storageSpace.full')]
        : tone === 'warn'
          ? ['warn', t('storageSpace.left', { size: size(Math.max(0, limit - used)) })]
          : ['ok', t('storageSpace.room')];
  return (
    <Card
      title={t('storageSpace.title')}
      className="space-card"
      action={<Badge tone={badge[0]}>{badge[1]}</Badge>}
    >
      <p className="space-card__big">
        {size(used)}{' '}
        <small>
          {limit === null ? t('storageSpace.used') : t('storageSpace.ofLimit', { limit: size(limit) })}
        </small>
      </p>
      {limit !== null && (
        <SpaceMeter
          originals={storage.originalBytes}
          derived={storage.derivedBytes}
          limit={limit}
          tone={tone}
          label={t('storageSpace.title')}
        />
      )}
      <p className="space-card__meta">
        {t('storageSpace.detail', {
          originals: size(storage.originalBytes),
          derived: size(storage.derivedBytes),
        })}
      </p>
      {(tone === 'danger' || storage.instanceFull) && (
        <p className="space-banner space-banner--danger" role="status">
          <Icon name="warning" size={14} />
          <span>{t(storage.instanceFull ? 'storageSpace.instanceFull' : 'storageSpace.fullHelp')}</span>
        </p>
      )}
      <div className="space-card__actions">
        <Button onClick={() => setFiles(true)}>{t('storageSpace.largest')}</Button>
      </div>
      <LargestFilesDialog
        open={files}
        path="/me/storage/files"
        title={t('storageSpace.largestTitle')}
        onClose={() => setFiles(false)}
      />
    </Card>
  );
}

/** The largest files of a person, with their project: what to look at to free space. */
export function LargestFilesDialog({
  open,
  path,
  title,
  onClose,
}: {
  open: boolean;
  path: string;
  title: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<StorageFiles | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFiles(null);
    setError(false);
    api
      .get<StorageFiles>(path)
      .then((data) => alive && setFiles(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [open, path]);
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      {error ? (
        <p role="alert">{t('auth.errors.generic')}</p>
      ) : !files ? (
        <p role="status">{t('admin.loading')}</p>
      ) : files.items.length === 0 && files.hiddenCount === 0 ? (
        <p className="settings-muted">{t('storageSpace.noFiles')}</p>
      ) : (
        <div className="space-files">
          <table>
            <thead className="ink-sr-only">
              <tr>
                <th scope="col">{t('storageSpace.file')}</th>
                <th scope="col">{t('admin.storageCharts.size')}</th>
              </tr>
            </thead>
            <tbody>
              {files.items.map((f) => (
                <tr key={f.id}>
                  <th scope="row">
                    <span className="space-files__name">{f.filename}</span>
                    <Link className="space-files__project" to={`/p/${f.projectId}`}>
                      {f.projectName}
                    </Link>
                  </th>
                  <td>{size(f.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {files.hiddenCount > 0 && (
            <p className="settings-muted">
              {t('storageSpace.hidden', {
                count: files.hiddenCount,
                size: size(files.hiddenBytes),
              })}
            </p>
          )}
          <p className="settings-muted">{t('storageSpace.filesHelp')}</p>
        </div>
      )}
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          {t('settings.tokens.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
