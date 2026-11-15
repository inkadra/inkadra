import type {
  LoadTestPreset,
  LoadTestProgress,
  LoadTestReport,
  LoadTestRun,
  LoadTests,
} from '@inkadra/shared';
import {
  Button,
  Checkbox,
  DateField,
  Icon,
  localDate,
  RadioGroup,
  Segmented,
  TimeField,
} from '@inkadra/ui';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/datetime.ts';
import { Badge, Card, Row } from '../settings-ui.tsx';
import { duration, number } from './format.ts';
import { ShareBar } from './SimpleView.tsx';

/** While a run is scheduled or running, the page asks for its numbers this often. */
export const LOAD_TEST_POLL_MS = 2000;
const ACTIVE = new Set(['scheduled', 'running']);
const REASONS = new Set([
  'store_slow',
  'api_slow',
  'api_errors',
  'edits_slow',
  'backup_running',
  'transfer_running',
  'loadtest_running',
  'under_load',
  'no_worker',
  'no_metrics',
  'shared_process',
  'internal',
]);
const STATUSES = new Set([
  'passed',
  'failed',
  'aborted',
  'stopped',
  'cancelled',
  'refused',
  'interrupted',
]);
const tomorrow = () => localDate(new Date(Date.now() + 86_400_000));

/**
 * Settings → Server: the load test of #902 run by the instance on itself (#908), with its
 * warning, a start now or later, live numbers and Stop, and the reports of the last runs.
 */
export function LoadTestCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [data, setData] = useState<LoadTests | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [preset, setPreset] = useState<LoadTestPreset>('small');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState('03:00');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();

  const load = useCallback(async () => {
    try {
      setData(await api.get<LoadTests>('/instance/load-tests'));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const active = data?.items.find((r) => ACTIVE.has(r.status)) ?? null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, LOAD_TEST_POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const failed = (err: unknown) => {
    const reason =
      err instanceof RequestError
        ? (err.details as { reason?: string } | undefined)?.reason
        : undefined;
    setError(
      reason && REASONS.has(reason)
        ? t(`server.loadTest.reasons.${reason}`)
        : t(
            err instanceof RequestError && err.status === 400
              ? 'server.loadTest.badTime'
              : 'server.loadTest.startError',
          ),
    );
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<LoadTestRun>('/instance/load-tests', {
        preset,
        ...(when === 'later' ? { at: { date, time } } : {}),
      });
      setUnderstood(false);
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  const stop = async (run: LoadTestRun) => {
    setBusy(true);
    setError(null);
    try {
      await api.post<LoadTestRun>(`/instance/load-tests/${run.id}/stop`, {});
      await load();
    } catch {
      setError(t('server.loadTest.stopError'));
    } finally {
      setBusy(false);
    }
  };

  const at = (iso: string) => formatDateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });
  const chosen = data?.presets.find((p) => p.name === preset);
  const minutes = (s: number) => duration(s * 1000, lang);
  const history = data?.items.filter((r) => !ACTIVE.has(r.status)) ?? [];

  return (
    <Card
      tour="server-loadtest"
      anchor="server.loadTest"
      title={t('server.loadTest.title')}
      body={t('server.loadTest.lead')}
    >
      {!data ? (
        <p role={loadError ? 'alert' : 'status'} className="settings-card__empty settings-muted">
          {t(loadError ? 'server.loadTest.loadError' : 'admin.loading')}
        </p>
      ) : !data.available ? (
        <Row
          icon="warning"
          tone="warn"
          label={t('server.loadTest.unavailable')}
          help={t('server.loadTest.unavailableHelp')}
        />
      ) : active ? (
        <ActiveRun run={active} busy={busy} onStop={() => void stop(active)} at={at} />
      ) : (
        <>
          <div className="settings-card__pad load-test__presets">
            <RadioGroup
              label={t('server.loadTest.preset')}
              value={preset}
              onChange={setPreset}
              // `all` mode: the test shares the live server's process, and `large` waits for a
              // worker role of its own.
              hint={data.separateWorker ? undefined : t('server.loadTest.sharedProcess')}
              options={data.presets.map((p) => {
                const blocked = p.name === 'large' && !data.separateWorker;
                const text = t('server.loadTest.presetText', {
                  editors: p.editors,
                  readers: p.readers,
                  boards: p.boards,
                  time: minutes(p.durationS),
                });
                return {
                  value: p.name,
                  label: t(`server.loadTest.presets.${p.name}`),
                  description: blocked ? `${text} · ${t('server.loadTest.needsWorker')}` : text,
                  disabled: blocked,
                };
              })}
            />
          </div>
          {chosen && (
            <Row
              className="load-test__warning"
              icon="warning"
              tone="warn"
              label={t('server.loadTest.warningTitle')}
              help={t('server.loadTest.warning', {
                time: minutes(chosen.durationS),
                boards: chosen.boards,
              })}
            />
          )}
          <Row label={t('server.loadTest.when')} help={t('server.loadTest.guard')}>
            <Segmented
              label={t('server.loadTest.when')}
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: t('server.loadTest.now') },
                { value: 'later', label: t('server.loadTest.later') },
              ]}
            />
          </Row>
          {when === 'later' && (
            <Row
              label={t('server.loadTest.at')}
              help={t('server.loadTest.timeZone', { zone: data.timeZone })}
              htmlFor={dateId}
            >
              <span className="load-test__at">
                <DateField
                  id={dateId}
                  label={t('server.loadTest.date')}
                  value={date}
                  min={localDate(new Date())}
                  required
                  onChange={setDate}
                />
                <TimeField
                  label={t('server.loadTest.time')}
                  value={time}
                  required
                  onChange={setTime}
                />
              </span>
            </Row>
          )}
          <div className="settings-card__pad load-test__start">
            <label className="load-test__confirm">
              <Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>{t('server.loadTest.understand')}</span>
            </label>
            <Button
              variant="primary"
              data-tour="server-loadtest-start"
              disabled={!understood || (when === 'later' && (!date || !time))}
              busy={busy}
              onClick={() => void start()}
            >
              {t(when === 'later' ? 'server.loadTest.schedule' : 'server.loadTest.start')}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="settings-card__pad load-test__error">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <ul className="settings-list load-test__history" aria-label={t('server.loadTest.history')}>
          {history.map((run) => (
            <li key={run.id}>
              <PastRun run={run} at={at} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActiveRun({
  run,
  busy,
  onStop,
  at,
}: {
  run: LoadTestRun;
  busy: boolean;
  onStop: () => void;
  at: (iso: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = t(`server.loadTest.presets.${run.preset}`);
  if (run.status === 'scheduled')
    return (
      <Row
        icon="clock"
        tone="accent"
        label={
          run.scheduledFor
            ? t('server.loadTest.scheduledFor', { preset: name, time: at(run.scheduledFor) })
            : t('server.loadTest.starting', { preset: name })
        }
        help={t('server.loadTest.scheduledHelp')}
      >
        <Button busy={busy} onClick={onStop}>
          {t('server.loadTest.cancel')}
        </Button>
      </Row>
    );
  const p = run.progress;
  const share = !p
    ? 0
    : p.phase === 'seeding'
      ? (p.seeded / Math.max(1, p.boards)) * 0.1
      : p.phase === 'running'
        ? 0.1 + (p.elapsedS / Math.max(1, p.durationS)) * 0.9
        : 1;
  const phase = !p
    ? t('server.loadTest.phase.starting')
    : p.phase === 'seeding'
      ? t('server.loadTest.phase.seeding', { done: p.seeded, total: p.boards })
      : p.phase === 'running'
        ? t('server.loadTest.phase.running', {
            done: clock(p.elapsedS),
            total: clock(p.durationS),
          })
        : t('server.loadTest.phase.cleaning');
  return (
    <>
      <Row
        icon="tiles"
        tone="accent"
        label={t('server.loadTest.running', { preset: name })}
        help={phase}
      >
        <Button variant="danger" busy={busy} onClick={onStop}>
          {t('server.loadTest.stop')}
        </Button>
      </Row>
      <div className="settings-card__pad">
        <ShareBar share={share} label={t('server.loadTest.progress')} text={phase} />
      </div>
      {p && <LiveNumbers progress={p} lang={lang} />}
    </>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function LiveNumbers({ progress: p, lang }: { progress: LoadTestProgress; lang: string }) {
  const { t } = useTranslation();
  const ms = (v: number | null) =>
    v === null ? '–' : t('server.loadTest.ms', { value: number(v, lang, 0) });
  const cells: Array<[string, string]> = [
    ['edits', number(p.edits, lang, 0)],
    ['editP95', ms(p.editP95Ms)],
    ['deliveryP95', ms(p.deliveryP95Ms)],
    ['storeP95', ms(p.storeP95Ms)],
    ['apiP95', ms(p.apiP95Ms)],
    ['errors', `${number(p.errors, lang, 0)} · ${number(p.reconnects, lang, 0)}`],
  ];
  return (
    <dl className="server-cells server-cells--3 load-test__live" aria-live="off">
      {cells.map(([key, value]) => (
        <div key={key} className="server-cell">
          <dt className="server-cell__label">{t(`server.loadTest.live.${key}`)}</dt>
          <dd className="server-cell__fact">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PastRun({ run, at }: { run: LoadTestRun; at: (iso: string) => string }) {
  const { t } = useTranslation();
  const status = STATUSES.has(run.status) ? run.status : 'interrupted';
  const tone =
    status === 'passed'
      ? 'ok'
      : status === 'failed' || status === 'aborted' || status === 'interrupted'
        ? 'warn'
        : 'neutral';
  const reason = run.reason && REASONS.has(run.reason) ? run.reason : null;
  const meta = [
    t(`server.loadTest.presets.${run.preset}`),
    reason ? t(`server.loadTest.reasons.${reason}`) : null,
    run.cleanedUp ? null : t('server.loadTest.notCleaned'),
  ]
    .filter(Boolean)
    .join(' · ');
  const head = (
    <>
      <span className="settings-list__text">
        <span className="settings-row__label">
          {at(run.startedAt ?? run.scheduledFor ?? run.createdAt)}
        </span>
        <span className="settings-row__help">{meta}</span>
      </span>
      <Badge tone={tone}>{t(`server.loadTest.status.${status}`)}</Badge>
    </>
  );
  if (!run.report) return <div className="load-test__run">{head}</div>;
  return (
    <details className="settings-fold load-test__run">
      <summary className="load-test__summary">
        {head}
        <Icon name="chevronRight" size={14} className="settings-fold__chevron" />
      </summary>
      <Report report={run.report} />
    </details>
  );
}

/** The CLI report's lines (#902) as a table: value, limit, and the lines past their limit. */
export function Report({ report: r }: { report: LoadTestReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const l = r.limits;
  const ms = (v: number | null) =>
    v === null ? '–' : t('server.loadTest.ms', { value: number(v, lang, v >= 100 ? 0 : 1) });
  const mib = (v: number | null) =>
    v === null ? '–' : t('server.loadTest.mib', { value: number(v, lang, v >= 100 ? 0 : 1) });
  const kib = (v: number | null) =>
    v === null ? '–' : t('server.loadTest.kib', { value: number(v, lang, v >= 100 ? 0 : 1) });
  const over = (v: number | null, limit: number | undefined) =>
    v !== null && limit !== undefined && v > limit;
  const times = (x: LoadTestReport['editMs']) =>
    t('server.loadTest.report.times', {
      p50: ms(x.p50),
      p95: ms(x.p95),
      p99: ms(x.p99),
      count: x.n,
    });
  const s = r.server;
  // The memory growth per board that does not decide (#911): shown, in a neutral style.
  const info = s?.perBoardInfo ?? null;
  const rows: Array<{
    key: string;
    value: string;
    limit: string | null;
    bad: boolean;
    info?: boolean;
  }> = [
    {
      key: 'edits',
      value: t('server.loadTest.report.editsValue', {
        edits: r.edits,
        switches: r.switches,
        uploads: r.uploads.ok,
        failed: r.uploads.failed,
      }),
      limit: null,
      bad: r.editMs.n === 0,
    },
    {
      key: 'editMs',
      value: times(r.editMs),
      limit: t('server.loadTest.report.p95p99', { p95: ms(l.editP95Ms), p99: ms(l.editP99Ms) }),
      bad: over(r.editMs.p95, l.editP95Ms) || over(r.editMs.p99, l.editP99Ms),
    },
    {
      key: 'deliveryMs',
      value: times(r.deliveryMs),
      limit: t('server.loadTest.report.p95', { value: ms(l.deliveryP95Ms) }),
      bad: over(r.deliveryMs.p95, l.deliveryP95Ms),
    },
    { key: 'errors', value: String(r.errors), limit: String(l.errors), bad: r.errors > l.errors },
    {
      key: 'reconnects',
      value: String(r.reconnects),
      limit: String(l.reconnects),
      bad: r.reconnects > l.reconnects,
    },
    ...(s
      ? [
          {
            key: 'stores',
            value: t('server.loadTest.report.storesValue', {
              p95: ms(s.storeP95Ms),
              max: ms(s.storeMaxMs),
            }),
            limit: t('server.loadTest.report.p95', { value: ms(l.storeP95Ms) }),
            bad: over(s.storeP95Ms, l.storeP95Ms),
          },
          {
            key: 'poolWait',
            value: ms(s.poolWaitMaxMs),
            limit: ms(l.poolWaitMaxMs),
            bad: over(s.poolWaitMaxMs, l.poolWaitMaxMs),
          },
          {
            key: 'connections',
            value: s.peakDbConnections === null ? '–' : String(s.peakDbConnections),
            limit: null,
            bad: false,
          },
          {
            key: 'memory',
            value: t('server.loadTest.report.memoryValue', {
              before: mib(s.baselineRssMiB),
              peak: mib(s.peakRssMiB),
            }),
            limit: mib(l.rssMiB),
            bad: over(s.peakRssMiB, l.rssMiB),
          },
          // Absent in reports from before #911.
          ...(s.docPerBoardKiB !== undefined
            ? [
                {
                  key: 'docs',
                  value: kib(s.docPerBoardKiB),
                  limit: l.docPerBoardKiB === undefined ? null : kib(l.docPerBoardKiB),
                  bad: over(s.docPerBoardKiB, l.docPerBoardKiB),
                },
              ]
            : []),
          {
            key: 'perBoard',
            value: t('server.loadTest.report.perBoardValue', {
              value: mib(s.perBoardMiB),
              count: s.peakOpenBoards,
            }),
            limit: info ? t('server.loadTest.report.infoOnly') : mib(l.perBoardMiB),
            bad: !info && over(s.perBoardMiB, l.perBoardMiB),
            info: !!info,
          },
        ]
      : []),
  ];
  return (
    <div className="settings-fold__body load-test__report">
      <p className="server-hint">
        {t('server.loadTest.report.setup', {
          editors: r.editors,
          readers: r.readers,
          boards: r.boards,
          time: duration(r.durationS * 1000, lang),
        })}
      </p>
      <table className="server-table load-test__table">
        <thead>
          <tr>
            <th scope="col">{t('server.loadTest.report.measure')}</th>
            <th scope="col">{t('server.loadTest.report.value')}</th>
            <th scope="col">{t('server.loadTest.report.limit')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={row.bad ? 'load-test__over' : row.info ? 'load-test__info' : undefined}
            >
              <th scope="row">{t(`server.loadTest.report.rows.${row.key}`)}</th>
              <td>
                {row.value}
                {row.bad && (
                  <span className="ink-sr-only"> {t('server.loadTest.report.overLimit')}</span>
                )}
              </td>
              <td>{row.limit ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!s && <p className="server-hint">{t('server.loadTest.report.noServer')}</p>}
      {info && (
        <p className="server-hint">
          {t(`server.loadTest.report.perBoardInfo.${info}`, {
            // RSS_MIN_BOARDS of apps/server/src/loadtest/report.ts.
            min: 20,
            defaultValue: t('server.loadTest.report.perBoardInfo.other'),
          })}
        </p>
      )}
      <details className="load-test__text">
        <summary>{t('server.loadTest.report.text')}</summary>
        <pre>
          <code>{r.text}</code>
        </pre>
      </details>
    </div>
  );
}
