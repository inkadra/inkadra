import type { StorageUsage } from '@inkadra/shared';
import { useTranslation } from 'react-i18next';
import { Card } from './settings-ui.tsx';
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

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ id: string; label: string; bytes: number }>;
  total: number;
}) {
  const { t, i18n } = useTranslation();
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes);
  const width = (bytes: number) => `${total ? (bytes / total) * 100 : 0}%`;
  return (
    <Card title={title} className="storage-chart">
      <div className="storage-chart__stack" aria-hidden="true">
        {sorted.map((row, i) => (
          <span
            key={row.id}
            style={{ width: width(row.bytes), background: SWATCHES[i % SWATCHES.length] }}
          />
        ))}
      </div>
      <table>
        <caption className="ink-sr-only">{t('admin.storageCharts.percentScope')}</caption>
        <thead className="ink-sr-only">
          <tr>
            <th scope="col">{t('admin.storageCharts.category')}</th>
            <th scope="col">{t('admin.storageCharts.size')}</th>
            <th scope="col">{t('admin.storageCharts.share')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.id}>
              <th scope="row">
                <span className="storage-chart__label">
                  <i style={{ background: SWATCHES[i % SWATCHES.length] }} aria-hidden="true" />
                  {row.label}
                </span>
                <span className="storage-chart__track" aria-hidden="true">
                  <span style={{ width: width(row.bytes) }} />
                </span>
              </th>
              <td>{formatStorage(row.bytes, i18n.language)}</td>
              <td>{storagePercent(row.bytes, total, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function StorageCharts({ usage }: { usage: StorageUsage }) {
  const { t, i18n } = useTranslation();
  const projects = usage.byProject.filter((p) => p.scope === 'project').length;
  const top = [...usage.byType].sort((a, b) => b.bytes - a.bytes)[0];
  return (
    <div className="storage-usage">
      <dl className="storage-tiles">
        <div>
          <dt>{t('settingsUi.storage.used')}</dt>
          <dd>{formatStorage(usage.originalBytes, i18n.language)}</dd>
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
      {usage.originalBytes === 0 ? (
        <Card>
          <p className="settings-card__empty">{t('admin.storageEmpty')}</p>
        </Card>
      ) : (
        <>
          <Breakdown
            title={t('admin.storageCharts.byProject')}
            total={usage.originalBytes}
            rows={usage.byProject.map((row) => ({
              id: row.projectId ?? row.scope,
              label:
                row.scope === 'project'
                  ? (row.name ?? t('admin.storageCharts.unassigned'))
                  : t(`admin.storageCharts.${row.scope}`),
              bytes: row.bytes,
            }))}
          />
          <Breakdown
            title={t('admin.storageCharts.byType')}
            total={usage.originalBytes}
            rows={usage.byType.map((row) => ({
              id: row.type,
              label: t(`admin.storageCharts.types.${row.type}`),
              bytes: row.bytes,
            }))}
          />
        </>
      )}
      <p className="settings-footnote">
        {t('admin.storageHelp')} {t('admin.storageCharts.attribution')}
      </p>
    </div>
  );
}
