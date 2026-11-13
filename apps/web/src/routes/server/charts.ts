import type { ServerStatus } from '@inkadra/shared';
import type { ChartMarker, ChartSpan } from './ServerChart.tsx';

type T = (key: string, values?: Record<string, unknown>) => string;

/** Under the chart: when the range starts, its middle, and now. */
export function xLabels(t: T, range: ServerStatus['range']): [string, string, string] {
  return [
    t(`server.chart.start.${range}`),
    t(`server.chart.middle.${range}`),
    t('server.chart.now'),
  ];
}

const WINDOW_MS: Record<ServerStatus['range'], number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

/** From the start of the range to the time of the reading. */
export function chartSpan(status: ServerStatus): ChartSpan {
  const to = new Date(status.checkedAt).getTime();
  return { from: to - WINDOW_MS[status.range], to, step: status.step * 1000 };
}

/** Videos converted and backups, when they happened. */
export function markers(t: T, status: ServerStatus): ChartMarker[] {
  if (!status.history.length) return [];
  const videos = (count: number) => t('server.chart.videos', { count });
  return status.events.map((e) =>
    e.kind === 'videos'
      ? { t: e.t, label: videos(e.count), count: e.count, relabel: videos }
      : {
          t: e.t,
          label: t(e.kind === 'backup' ? 'server.chart.backup' : 'server.chart.backupFailed'),
        },
  );
}

export const mbit = (bytes: number | null) => (bytes === null ? null : (bytes * 8) / 1e6);
