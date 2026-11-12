import type { StorageUsage } from '@inkadra/shared';
import { Avatar, Icon, glyphColor } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, Row, Segmented } from './settings-ui.tsx';
import './storage-charts.css';

export function formatStorage(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3)) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 2 : 0 }).format(bytes / 1000 ** index)} ${units[index]}`;
}
export function storagePercent(bytes: number, total: number, locale: string): string {
  const fraction = total > 0 ? bytes / total : 0;
  const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  return fraction > 0 && fraction < 0.001 ? `<${format.format(0.001)}` : format.format(fraction);
}

const SWATCHES = [
  'var(--ink-accent-primary)',
  'var(--ink-tag-blue)',
  'var(--ink-tag-purple)',
  'var(--ink-tag-green)',
  'var(--ink-tag-orange)',
  'var(--ink-text-muted)',
];

/** A project's own icon colour; restricted, unassigned and colourless (older server) rows stay neutral. */
export function projectSwatch(row: StorageUsage['byProject'][number]): string {
  return (row.scope === 'project' && row.color && glyphColor[row.color]) || glyphColor.neutral;
}

type View = 'project' | 'user' | 'type';
/** Files with no linked account: a neutral avatar, ring and segment. */
const NO_ACCOUNT = 'var(--ink-border-strong)';

type Rows = Array<{
  id: string;
  label: string;
  bytes: number;
  color?: string;
  /** Per person: their avatar, ringed in their colour; null for files with no linked account. */
  person?: { image?: string | null } | null;
}>;

/** One breakdown: a stacked bar, then one row per category with its bar, size and share. */
function Breakdown({ title, rows, total }: { title: string; rows: Rows; total: number }) {
  const { t, i18n } = useTranslation();
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes);
  const width = (bytes: number) => `${total ? (bytes / total) * 100 : 0}%`;
  return (
    <div className="settings-card__pad storage-chart__body">
      <div className="storage-chart__stack" aria-hidden="true">
        {sorted.map((row, i) => (
          <span
            key={row.id}
            style={{
              width: width(row.bytes),
              background: row.color ?? SWATCHES[i % SWATCHES.length],
            }}
          />
        ))}
      </div>
      <table>
        <caption className="ink-sr-only">
          {title}. {t('admin.storageCharts.percentScope')}
        </caption>
        <thead className="ink-sr-only">
          <tr>
            <th scope="col">{t('admin.storageCharts.category')}</th>
            <th scope="col">{t('admin.storageCharts.size')}</th>
            <th scope="col">{t('admin.storageCharts.share')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const color = row.color ?? SWATCHES[i % SWATCHES.length];
            const track = (
              <span className="storage-chart__track" aria-hidden="true">
                <span
                  style={{
                    width: width(row.bytes),
                    ...(row.person !== undefined && { background: color }),
                  }}
                />
              </span>
            );
            return (
              <tr key={row.id}>
                <th scope="row">
                  {row.person === undefined ? (
                    <>
                      <span className="storage-chart__label">
                        <i style={{ background: color }} aria-hidden="true" />
                        {row.label}
                      </span>
                      {track}
                    </>
                  ) : (
                    <span className="storage-chart__person">
                      <span className="storage-chart__ring" style={{ color }} aria-hidden="true">
                        {row.person ? (
                          <Avatar name={row.label} image={row.person.image} size={32} />
                        ) : (
                          <span className="ink-avatar" style={{ width: 32, height: 32 }}>
                            <Icon name="user" size={16} />
                          </span>
                        )}
                      </span>
                      <span>
                        <span className="storage-chart__label">{row.label}</span>
                        {track}
                      </span>
                    </span>
                  )}
                </th>
                <td>{formatStorage(row.bytes, i18n.language)}</td>
                <td>{storagePercent(row.bytes, total, i18n.language)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Storage figures, then one card of use (decision 0124) whose choice switches between per
 * project, per person and per type, instead of three cards.
 */
export function StorageCharts({ usage }: { usage: StorageUsage }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>('project');
  const projects = usage.byProject.filter((p) => p.scope === 'project').length;
  const top = [...usage.byType].sort((a, b) => b.bytes - a.bytes)[0];
  const breakdowns: Partial<Record<View, { title: string; total: number; rows: Rows }>> = {
    project: {
      title: t('admin.storageCharts.byProject'),
      total: usage.originalBytes,
      rows: usage.byProject.map((row) => ({
        id: row.projectId ?? row.scope,
        label:
          row.scope === 'project'
            ? (row.name ?? t('admin.storageCharts.unassigned'))
            : t(`admin.storageCharts.${row.scope}`),
        bytes: row.bytes,
        color: projectSwatch(row),
      })),
    },
    ...(usage.byUser && {
      user: {
        title: t('admin.storageCharts.byUser'),
        total: usage.originalBytes + (usage.derivedBytes ?? 0),
        rows: usage.byUser.map((row) => ({
          id: row.userId ?? 'none',
          label: row.name ?? t('admin.storageCharts.noUser'),
          bytes: row.bytes + (row.derivedBytes ?? 0),
          // Older servers send no image: initials.
          ...(row.userId ? { person: { image: row.image } } : { person: null, color: NO_ACCOUNT }),
        })),
      },
    }),
    type: {
      title: t('admin.storageCharts.byType'),
      total: usage.originalBytes,
      rows: usage.byType.map((row) => ({
        id: row.type,
        label: t(`admin.storageCharts.types.${row.type}`),
        bytes: row.bytes,
      })),
    },
  };
  const shown = breakdowns[view] ?? breakdowns.project;
  return (
    <>
      <Card>
        <dl className="settings-tiles storage-tiles">
          <div>
            <dt>{t('settingsUi.storage.used')}</dt>
            <dd>{formatStorage(usage.originalBytes + (usage.derivedBytes ?? 0), i18n.language)}</dd>
            {usage.derivedBytes !== undefined && (
              <dd className="storage-tiles__detail">
                {t('admin.storageCharts.usedDetail', {
                  originals: formatStorage(usage.originalBytes, i18n.language),
                  previews: formatStorage(usage.derivedBytes, i18n.language),
                })}
              </dd>
            )}
          </div>
          <div>
            <dt>{t('admin.projects')}</dt>
            <dd>{projects}</dd>
          </div>
          <div>
            <dt>{t('settingsUi.storage.top')}</dt>
            <dd>{top?.bytes ? t(`admin.storageCharts.types.${top.type}`) : '—'}</dd>
          </div>
        </dl>
      </Card>
      {usage.originalBytes === 0 ? (
        <Card title={t('settingsUi.storage.usage')}>
          <p className="settings-card__empty">{t('admin.storageEmpty')}</p>
        </Card>
      ) : (
        shown && (
          <Card
            title={t('settingsUi.storage.usage')}
            className="storage-chart"
            action={
              <Segmented
                label={t('settingsUi.storage.usage')}
                value={view}
                onChange={setView}
                options={(Object.keys(breakdowns) as View[]).map((value) => ({
                  value,
                  label: t(`settingsUi.storage.by.${value}`),
                }))}
              />
            }
          >
            <Breakdown title={shown.title} total={shown.total} rows={shown.rows} />
            {view === 'user' && (
              <Row label={t('admin.members')} help={t('admin.storageCharts.attributionUser')}>
                <Link className="ink-btn ink-btn--secondary" to="/settings/team" replace>
                  {t('storageLimits.openMembers')}
                </Link>
              </Row>
            )}
          </Card>
        )
      )}
      <p className="settings-footnote">
        {t(usage.derivedBytes === undefined ? 'admin.storageHelp' : 'admin.storageCharts.scope')}{' '}
        {t('admin.storageCharts.attribution')}
        {usage.byUser && ` ${t('admin.storageCharts.attributionUser')}`}
      </p>
    </>
  );
}
