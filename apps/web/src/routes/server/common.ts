import type {
  DiagnosticCheck,
  ServerAlerts,
  ServerLive,
  ServerProblem,
  ServerRange,
  ServerStatus,
} from '@inkadra/shared';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/datetime.ts';
import { chartSpan } from './charts.ts';
import { dayOf } from './format.ts';

/** What both views need besides the status: actions on problems, alerts, the feedback form. */
export interface ServerActions {
  retry: (problem: ServerProblem) => Promise<void>;
  seen: (problem: ServerProblem) => Promise<void>;
  retryAll: () => Promise<void>;
  seenAll: () => Promise<void>;
  saveAlerts: (patch: Partial<ServerAlerts>) => Promise<void>;
  sendToDevelopers: () => void;
  range: ServerRange;
  setRange: (range: ServerRange) => void;
  /** An action that failed, in words. */
  actionError: string | null;
  /** When the values on screen were read (ms), for "updated 3 s ago". */
  updatedAt: number | null;
}

/**
 * The live values merged into the full status: the values of now, and the newest points in
 * place of the ones of the same time, then the window moves on. Today's traffic and the share
 * of errors stay those of the full status, which reads them every 30 s.
 */
export function mergeLive(status: ServerStatus, live: ServerLive): ServerStatus {
  if (live.range !== status.range || live.checkedAt < status.checkedAt) return status;
  const { from } = chartSpan({ ...status, checkedAt: live.checkedAt });
  const byTime = new Map(status.history.map((s) => [s.t, s]));
  for (const s of live.history) byTime.set(s.t, s);
  return {
    ...status,
    checkedAt: live.checkedAt,
    history: [...byTime.values()]
      .filter((s) => Date.parse(s.t) >= from)
      .sort((a, b) => a.t.localeCompare(b.t)),
    now: {
      cpu: live.now.cpu,
      memory: live.now.memory,
      network: live.now.network
        ? {
            ...live.now.network,
            todayIn: status.now.network?.todayIn ?? 0,
            todayOut: status.now.network?.todayOut ?? 0,
          }
        : null,
      responses: { ...status.now.responses, p95: live.now.p95 },
    },
  };
}

/**
 * "Technical details in Advanced" (Simple view): the problem to show in the error log. While
 * it is set the page shows the Advanced view without saving it as the preference.
 */
let peeked: string | null = null;
const peekers = new Set<() => void>();
export function peekProblem(id: string | null) {
  if (peeked === id) return;
  peeked = id;
  for (const listener of peekers) listener();
}
export function usePeek(): string | null {
  return useSyncExternalStore(
    (listener) => {
      peekers.add(listener);
      return () => peekers.delete(listener);
    },
    () => peeked,
    () => peeked,
  );
}

/** The text sent with a report: the problems and the state, without names or contents. */
export function technicalSummary(status: ServerStatus, checks: DiagnosticCheck[]): string {
  const lines = [
    `Inkadra ${status.version}${status.image ? ` (${status.image})` : ''}`,
    `processes: ${status.processes.map((p) => `${p.role} ${p.status}`).join(', ')}`,
    `services: ${status.services.map((s) => `${s.id} ${s.status}`).join(', ')}`,
    `cpu ${status.now.cpu.used.toFixed(2)}/${status.now.cpu.cores} cores · memory ${status.now.memory.used}/${status.now.memory.limit ?? '?'} B`,
    `storage ${status.storage.driver} used ${status.storage.used} B free ${status.storage.free ?? '?'} B`,
    `encoder ${status.encoder?.label ?? 'none'} · database ${status.database.version ?? '?'}`,
    `queues: ${status.queues.map((q) => `${q.id} ${q.waiting}/${q.active}/${q.failed24h}`).join(', ')}`,
    `checks: ${checks.map((c) => `${c.id} ${c.status}`).join(', ')}`,
    ...status.problems
      .filter((p) => !p.seen)
      .map((p) => `${p.lastAt} ×${p.count} ${p.kind}: ${p.technical.replace(/\n/g, ' · ')}`),
  ];
  return lines.join('\n');
}

/** "tonight at 3:00", "today at 14:02", "yesterday at 19:40" or the date. */
export function useWhen() {
  const { t } = useTranslation();
  return (iso: string, now = Date.now()) => {
    const time = formatDateTime(iso, { timeStyle: 'short' });
    const day = dayOf(iso, now);
    if (day === 'today')
      return new Date(iso).getHours() < 6
        ? t('server.when.night', { time })
        : t('server.when.today', { time });
    if (day === 'yesterday') return t('server.when.yesterday', { time });
    if (day === 'tomorrow') return t('server.when.tomorrow', { time });
    return formatDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });
  };
}
