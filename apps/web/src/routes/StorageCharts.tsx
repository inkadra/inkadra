import type { StorageUsage } from '@inkadra/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
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
  const id = useId();
  return (
    <section className="storage-chart" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <table>
        <caption className="storage-chart__caption">
          {t('admin.storageCharts.percentScope')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('admin.storageCharts.category')}</th>
            <th scope="col">{t('admin.storageCharts.size')}</th>
            <th scope="col">{t('admin.storageCharts.share')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <span>{row.label}</span>
                <span className="storage-chart__track" aria-hidden="true">
                  <span style={{ width: `${total ? (row.bytes / total) * 100 : 0}%` }} />
                </span>
              </th>
              <td>{formatStorage(row.bytes, i18n.language)}</td>
              <td>{storagePercent(row.bytes, total, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function StorageCharts({ usage }: { usage: StorageUsage }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="storage-usage">
      <p className="storage-usage__total">{formatStorage(usage.originalBytes, i18n.language)}</p>
      <p className="ink-muted">{t('admin.storageHelp')}</p>
      <p className="ink-muted">{t('admin.storageCharts.attribution')}</p>
      {usage.originalBytes === 0 ? (
        <p>{t('admin.storageEmpty')}</p>
      ) : (
        <>
          <Breakdown
            title={t('admin.storageCharts.byType')}
            total={usage.originalBytes}
            rows={usage.byType.map((row) => ({
              id: row.type,
              label: t(`admin.storageCharts.types.${row.type}`),
              bytes: row.bytes,
            }))}
          />
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
        </>
      )}
    </div>
  );
}
