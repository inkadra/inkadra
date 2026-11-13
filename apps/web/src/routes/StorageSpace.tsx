import type { MyStorage, StorageFiles } from '@inkadra/shared';
import { Button, Dialog, DialogActions, glyphColor, Icon, ListRow, Segmented } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import {
  type FileFilter,
  filesSummary,
  filterCounts,
  filterFiles,
  typeBadge,
} from './largest-files.ts';
import { formatStorage, storagePercent } from './StorageCharts.tsx';
import { Badge, Card, Row } from './settings-ui.tsx';
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
    // biome-ignore lint/a11y/useSemanticElements: two segments (originals, copies), which <meter> cannot draw
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
    <Card title={t('storageSpace.title')}>
      <Row
        className="space-row"
        label={`${size(used)} ${
          limit === null
            ? t('storageSpace.used')
            : t('storageSpace.ofLimit', { limit: size(limit) })
        }`}
        help={
          <>
            {t('storageSpace.detail', {
              originals: size(storage.originalBytes),
              derived: size(storage.derivedBytes),
            })}
            {limit !== null && (
              <SpaceMeter
                originals={storage.originalBytes}
                derived={storage.derivedBytes}
                limit={limit}
                tone={tone}
                label={t('storageSpace.title')}
              />
            )}
          </>
        }
      >
        <Badge tone={badge[0]}>{badge[1]}</Badge>
        <Button onClick={() => setFiles(true)}>{t('storageSpace.largest')}</Button>
      </Row>
      {(tone === 'danger' || storage.instanceFull) && (
        <p className="space-banner space-banner--danger" role="status">
          <Icon name="warning" size={14} />
          <span>
            {t(storage.instanceFull ? 'storageSpace.instanceFull' : 'storageSpace.fullHelp')}
          </span>
        </p>
      )}
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
  theirs = false,
  onClose,
}: {
  open: boolean;
  path: string;
  title: string;
  /** An administrator looking at someone else's files: the texts speak of "their" space. */
  theirs?: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<StorageFiles | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FileFilter>('all');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFiles(null);
    setError(false);
    setFilter('all');
    api
      .get<StorageFiles>(path)
      .then((data) => alive && setFiles(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [open, path]);
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const loaded = files && (files.items.length > 0 || files.hiddenCount > 0) ? files : null;
  const total = loaded?.totalBytes;
  const counts = loaded ? filterCounts(loaded.items) : null;
  const summary =
    loaded && total !== undefined && loaded.items.length > 0
      ? filesSummary(loaded.items, total)
      : null;
  const width = (bytes: number) => `${total ? (bytes / total) * 100 : 0}%`;
  return (
    <div className="phone-sheet">
      <Dialog open={open} title={title} onClose={onClose}>
        {error ? (
          <p role="alert">{t('auth.errors.generic')}</p>
        ) : !files ? (
          <p role="status">{t('admin.loading')}</p>
        ) : !loaded ? (
          <p className="settings-muted">{t('storageSpace.noFiles')}</p>
        ) : (
          <div className="space-files">
            {loaded.items.length > 0 && (
              <p className="space-files__sub">
                {t(theirs ? 'storageSpace.filesSubTheirs' : 'storageSpace.filesSub', {
                  count: loaded.items.length,
                })}
              </p>
            )}
            {summary && total !== undefined && (
              <div className="space-files__summary">
                <p>
                  <Trans
                    i18nKey={theirs ? 'storageSpace.topFilesTheirs' : 'storageSpace.topFiles'}
                    count={summary.top.count}
                    values={{
                      size: size(summary.top.bytes),
                      percent: storagePercent(summary.top.bytes, total, i18n.language),
                      total: size(total),
                    }}
                    components={{ b: <b /> }}
                  />
                </p>
                <div className="storage-chart__stack" aria-hidden="true">
                  {summary.projects.map((p) => (
                    <span
                      key={p.id}
                      style={{ width: width(p.bytes), background: swatch(p.color) }}
                    />
                  ))}
                  {summary.restBytes > 0 && (
                    <span
                      className="space-files__rest"
                      style={{ width: width(summary.restBytes) }}
                    />
                  )}
                </div>
                <ul className="space-files__legend">
                  {summary.projects.map((p) => (
                    <li key={p.id}>
                      <i style={{ background: swatch(p.color) }} aria-hidden="true" />
                      <span className="space-files__name">{p.name}</span>
                      <span>· {size(p.bytes)}</span>
                    </li>
                  ))}
                  {summary.restBytes > 0 && (
                    <li>
                      <i className="space-files__rest" aria-hidden="true" />
                      <span>{t('storageSpace.rest')}</span>
                      <span>· {size(summary.restBytes)}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {counts && loaded.items.some((f) => f.kind) && (
              <Segmented<FileFilter>
                className="space-files__filter"
                label={t('storageSpace.filter')}
                value={filter}
                onChange={setFilter}
                options={(['all', 'videos', 'images', 'other'] as const).map((value) => ({
                  value,
                  disabled: value !== 'all' && counts[value] === 0,
                  label: (
                    <>
                      {t(`storageSpace.filters.${value}`)}
                      <span className="space-files__count">{counts[value]}</span>
                    </>
                  ),
                }))}
              />
            )}
            {loaded.items.length > 0 && (
              <ul className="space-files__list">
                {filterFiles(loaded.items, filter).map((f) => (
                  <li key={f.id}>
                    <FileRow file={f} total={total} onOpen={onClose} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogActions>
          {loaded && (
            <p className="space-files__note">
              {loaded.hiddenCount > 0 &&
                `${t('storageSpace.hidden', {
                  count: loaded.hiddenCount,
                  size: size(loaded.hiddenBytes),
                })} `}
              {t('storageSpace.filesHelp')}
            </p>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('settings.tokens.done')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** A project's own colour; neutral when an older server does not send it. */
const swatch = (color: StorageFiles['items'][number]['projectColor']) =>
  (color && glyphColor[color]) || glyphColor.neutral;

/**
 * One file: a preview, its name, project and type, and its size and share. The whole row is a
 * link: to its card on the board where one shows it ("Apri"), else to the project.
 */
function FileRow({
  file: f,
  total,
  onOpen,
}: {
  file: StorageFiles['items'][number];
  total: number | undefined;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const card = f.boardId && f.cardId ? { boardId: f.boardId, cardId: f.cardId } : null;
  const badge = f.kind ? typeBadge(f.filename) : null;
  return (
    <Link
      className="ink-row space-file"
      to={
        card
          ? `/p/${f.projectId}/b/${card.boardId}?el=${encodeURIComponent(card.cardId)}`
          : `/p/${f.projectId}`
      }
      onClick={onOpen}
    >
      <ListRow
        lead={
          <span className="space-file__thumb" aria-hidden="true">
            {f.thumbnailUrl ? (
              <>
                <img src={f.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                {f.kind === 'videos' && (
                  <span className="space-file__play">
                    <Icon name="play" size={12} />
                  </span>
                )}
              </>
            ) : badge ? (
              badge
            ) : (
              <Icon name="file" size={16} />
            )}
          </span>
        }
        title={<span title={f.filename}>{f.filename}</span>}
        where={
          <>
            <i className="space-file__dot" style={{ background: swatch(f.projectColor) }} />
            <span>{f.projectName}</span>
            {f.kind && (
              <>
                <span className="space-file__sep">·</span>
                <span className="space-file__kind">{t(`storageSpace.kinds.${f.kind}`)}</span>
              </>
            )}
          </>
        }
        trail={
          <>
            {card && (
              <span className="ink-btn ink-btn--secondary space-file__open" aria-hidden="true">
                {t('storageSpace.open')}
              </span>
            )}
            <span className="space-file__size">
              {formatStorage(f.bytes, i18n.language)}
              {total ? <small>{storagePercent(f.bytes, total, i18n.language)}</small> : null}
            </span>
          </>
        }
      />
    </Link>
  );
}
