import type {
  DiagnosticCheck,
  ServerAlerts,
  ServerProblem,
  ServerRange,
  ServerStatus,
} from '@inkadra/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/datetime.ts';
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
    return formatDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });
  };
}
