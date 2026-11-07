import type { ServerStatus } from '@inkadra/shared';
import { Segmented } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatStorage } from '../StorageCharts.tsx';
import { niceMax, number } from './format.ts';
import { type ChartMarker, ServerChart } from './ServerChart.tsx';

type T = (key: string, values?: Record<string, unknown>) => string;

/** Under the chart: when the range starts, its middle, and now. */
export function xLabels(t: T, range: ServerStatus['range']): [string, string, string] {
  return [
    t(`server.chart.start.${range}`),
    t(`server.chart.middle.${range}`),
    t('server.chart.now'),
  ];
}

/** Videos converted and backups, at the nearest point of the history. */
export function markers(t: T, status: ServerStatus): ChartMarker[] {
  const times = status.history.map((s) => new Date(s.t).getTime());
  if (!times.length) return [];
  const nearest = (iso: string) => {
    const at = new Date(iso).getTime();
    let best = 0;
    times.forEach((time, i) => {
      if (Math.abs(time - at) < Math.abs((times[best] ?? 0) - at)) best = i;
    });
    return best;
  };
  return status.events.map((e) => ({
    index: nearest(e.t),
    label:
      e.kind === 'videos'
        ? t('server.chart.videos', { count: e.count })
        : t(e.kind === 'backup' ? 'server.chart.backup' : 'server.chart.backupFailed'),
  }));
}

export const mbit = (bytes: number | null) => (bytes === null ? null : (bytes * 8) / 1e6);

/** Memory axis: the limit when there is one, else the highest value rounded up. */
export function memoryMax(status: ServerStatus): number {
  const peak = Math.max(0, ...status.history.map((s) => s.memory ?? 0));
  return status.now.memory.limit ?? niceMax(peak || 1);
}

export type Metric = 'cpu' | 'memory' | 'network';

/** The one chart of the simple view: processor, memory or internet over the period. */
export function HistoryChart({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [metric, setMetric] = useState<Metric>('cpu');
  const h = status.history;
  const times = h.map((s) => s.t);
  const range = t(`server.chart.ranges.${status.range}`);
  const memMax = memoryMax(status);
  const netMax = niceMax(Math.max(1, ...h.flatMap((s) => [mbit(s.in) ?? 0, mbit(s.out) ?? 0])));
  const chart =
    metric === 'cpu'
      ? {
          series: [
            { label: t('server.chart.cpu'), tone: 'cpu' as const, values: h.map((s) => s.cpu) },
          ],
          max: 100,
          ticks: [0, 50, 100],
          format: (v: number) => `${number(v, lang, 0)} %`,
        }
      : metric === 'memory'
        ? {
            series: [
              {
                label: t('server.chart.memory'),
                tone: 'memory' as const,
                values: h.map((s) => s.memory),
              },
            ],
            max: memMax,
            ticks: [0, memMax / 2, memMax],
            format: (v: number) => formatStorage(v, lang),
          }
        : {
            series: [
              {
                label: t('server.chart.received'),
                tone: 'in' as const,
                values: h.map((s) => mbit(s.in)),
              },
              {
                label: t('server.chart.sent'),
                tone: 'out' as const,
                values: h.map((s) => mbit(s.out)),
              },
            ],
            max: netMax,
            ticks: [0, netMax / 2, netMax],
            format: (v: number) => `${number(v, lang)} Mbit/s`,
          };
  return (
    <div className="server-trend">
      <Segmented
        label={t('server.chart.metric')}
        value={metric}
        onChange={setMetric}
        options={(['cpu', 'memory', 'network'] as const).map((m) => ({
          value: m,
          label: t(`server.chart.${m}`),
        }))}
      />
      {h.length === 0 ? (
        <p className="settings-card__empty settings-muted">{t('server.chart.empty')}</p>
      ) : (
        <>
          <ServerChart
            label={t('server.chart.label', { metric: t(`server.chart.${metric}`), range })}
            times={times}
            {...chart}
            xLabels={xLabels(t, status.range)}
            markers={metric === 'network' ? [] : markers(t, status)}
          />
          {metric === 'network' && (
            <div className="server-legend">
              <span>
                <i className="server-legend__swatch server-legend__swatch--in" />
                {t('server.chart.received')} (Mbit/s)
              </span>
              <span>
                <i className="server-legend__swatch server-legend__swatch--out" />
                {t('server.chart.sent')} (Mbit/s)
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
