import type { DiagnosticCheck, ServerRange, ServerStatus } from '@inkadra/shared';
import { Button, Segmented, Select } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatStorage } from '../StorageCharts.tsx';
import { Card } from '../settings-ui.tsx';
import { markers, mbit, memoryMax, xLabels } from './charts.tsx';
import { type ServerActions, useWhen } from './common.ts';
import { bits, duration, niceMax, number, openProblems, percent } from './format.ts';
import { ServerChart } from './ServerChart.tsx';
import {
  configStatus,
  People,
  PROBLEMS_ID,
  ProcessTable,
  problemText,
  QueueTable,
} from './SimpleView.tsx';

type Props = { status: ServerStatus; checks: DiagnosticCheck[]; actions: ServerActions };

const RANGES: ServerRange[] = ['15m', '1h', '24h', '7d'];

const mean = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};
const peak = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
};

/** One line with what an administrator checks first, and the period of every chart. */
function Summary({ status, checks, actions }: Props) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const lang = i18n.language;
  const now = new Date(status.checkedAt).getTime();
  const ok = checks.filter((c) => c.status === 'ok').length;
  const roles = [...new Set(status.processes.map((p) => t(`server.roles.${p.role}`)))];
  const item = (label: string, value: ReactNode, tone?: 'ok' | 'warn') => (
    <div>
      <dt>{label}</dt>
      <dd className={tone ? `server-strip__value--${tone}` : undefined}>{value}</dd>
    </div>
  );
  return (
    <div className="server-strip" data-tour="server">
      <dl>
        {item(t('server.advanced.version'), status.version)}
        {status.startedAt &&
          item(
            t('server.advanced.uptime'),
            duration(now - new Date(status.startedAt).getTime(), lang, 'short'),
          )}
        {item(t('server.advanced.processes'), roles.join(' · ') || '—')}
        {item(
          t('server.advanced.video'),
          status.encoder ? status.encoder.backend.toUpperCase() : '—',
        )}
        {item(
          t('server.advanced.checks'),
          t('server.advanced.checksValue', { ok, total: checks.length }),
          configStatus(checks) === 'ok' ? 'ok' : 'warn',
        )}
        {item(
          t('server.advanced.p95'),
          status.now.responses.p95 === null
            ? '—'
            : `${number(status.now.responses.p95, lang, 0)} ms`,
        )}
        {item(
          t('server.advanced.backup'),
          status.backup.lastAt ? when(status.backup.lastAt, now) : '—',
          status.backup.lastStatus === 'ready'
            ? 'ok'
            : status.backup.lastStatus === 'failed'
              ? 'warn'
              : undefined,
        )}
      </dl>
      <Segmented
        label={t('server.advanced.range')}
        value={actions.range}
        onChange={actions.setRange}
        options={RANGES.map((r) => ({ value: r, label: t(`server.advanced.ranges.${r}`) }))}
      />
    </div>
  );
}

function Tile({
  label,
  meta,
  value,
  sub,
  children,
}: {
  label: string;
  meta: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="server-tile">
      <div className="server-tile__head">
        <span>{label}</span>
        <span className="server-tile__meta">{meta}</span>
      </div>
      <div className="server-meter__value">{value}</div>
      {sub && <div className="server-meter__hint">{sub}</div>}
      {children}
    </div>
  );
}

function Tiles({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const h = status.history;
  const times = h.map((s) => s.t);
  const { cpu, memory, network } = status.now;
  const store = status.storage;
  const spark = (
    label: string,
    tone: 'cpu' | 'memory' | 'in',
    values: Array<number | null>,
    max: number,
  ) => (
    <ServerChart
      compact
      label={label}
      times={times}
      series={[{ label, tone, values }]}
      max={max}
      ticks={[]}
      format={(v) => String(v)}
      xLabels={['', '', '']}
      height={28}
    />
  );
  const inMax = niceMax(Math.max(1, ...h.map((s) => mbit(s.in) ?? 0)));
  return (
    <section className="server-tiles" aria-label={t('server.advanced.summary')}>
      <Tile
        label={t('server.advanced.cpu')}
        meta={t('server.advanced.cores', { count: Math.round(cpu.cores * 10) / 10 })}
        value={
          <>
            {cpu.cores ? number((cpu.used / cpu.cores) * 100, lang, 0) : '—'}
            <small> %</small>
          </>
        }
      >
        {spark(
          t('server.advanced.cpu'),
          'cpu',
          h.map((s) => s.cpu),
          100,
        )}
      </Tile>
      <Tile
        label={t('server.advanced.memory')}
        meta={
          memory.limit
            ? t('server.advanced.limit', { size: formatStorage(memory.limit, lang) })
            : ''
        }
        value={formatStorage(memory.used, lang)}
      >
        {spark(
          t('server.advanced.memory'),
          'memory',
          h.map((s) => s.memory),
          memoryMax(status),
        )}
      </Tile>
      <Tile
        label={t('server.advanced.network')}
        meta={t('server.advanced.container')}
        value={network ? <>↓ {bits(network.in, lang)}</> : '—'}
        sub={
          network
            ? `↑ ${bits(network.out, lang)} · ${t('server.advanced.today', {
                in: formatStorage(network.todayIn, lang),
                out: formatStorage(network.todayOut, lang),
              })}`
            : undefined
        }
      >
        {spark(
          t('server.advanced.network'),
          'in',
          h.map((s) => mbit(s.in)),
          inMax,
        )}
      </Tile>
      <Tile
        label={t('server.advanced.storage')}
        meta={`${store.driver} · ${store.location}`}
        value={
          <>
            {formatStorage(store.used, lang)}
            {store.total !== null && <small> / {formatStorage(store.total, lang)}</small>}
          </>
        }
        sub={t('server.advanced.storageSplit', {
          originals: formatStorage(store.originals, lang),
          copies: formatStorage(store.copies, lang),
          previews: formatStorage(store.previews, lang),
        })}
      >
        {store.total !== null && (
          <span className="server-bar" aria-hidden="true">
            <span
              className="server-bar__fill server-bar__fill--cpu"
              style={{ width: `${(store.used / store.total) * 100}%` }}
            />
          </span>
        )}
      </Tile>
    </section>
  );
}

function ChartCard({
  title,
  meta,
  caption,
  children,
}: {
  title: string;
  meta?: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <Card
      title={title}
      body={caption}
      action={meta ? <span className="settings-card__meta">{meta}</span> : undefined}
    >
      <div className="server-chart-card">{children}</div>
    </Card>
  );
}

function Charts({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const h = status.history;
  const times = h.map((s) => s.t);
  const labels = xLabels(t, status.range);
  const marks = markers(t, status);
  const cpu = h.map((s) => s.cpu);
  const mem = h.map((s) => s.memory);
  const lat = h.map((s) => s.p95);
  const memMax = memoryMax(status);
  const latMax = niceMax(Math.max(100, ...lat.map((v) => v ?? 0)));
  const netMax = niceMax(Math.max(1, ...h.flatMap((s) => [mbit(s.in) ?? 0, mbit(s.out) ?? 0])));
  const pct = (v: number | null) => (v === null ? '—' : `${number(v, lang, 0)} %`);
  const errors = mean(h.map((s) => s.errors));
  const range = t(`server.chart.ranges.${status.range}`);
  if (!h.length)
    return (
      <Card title={t('server.chart.title')}>
        <p className="settings-card__empty settings-muted">{t('server.chart.empty')}</p>
      </Card>
    );
  return (
    <>
      <div className="server-grid">
        <ChartCard
          title={t('server.advanced.cpu')}
          meta={t('server.advanced.cpuMeta', { avg: pct(mean(cpu)), peak: pct(peak(cpu)) })}
          caption={t('server.advanced.cpuCap', {
            count: Math.round(status.now.cpu.cores * 10) / 10,
          })}
        >
          <ServerChart
            label={t('server.chart.label', { metric: t('server.advanced.cpu'), range })}
            times={times}
            series={[{ label: t('server.advanced.cpu'), tone: 'cpu', values: cpu }]}
            max={100}
            ticks={[0, 50, 100]}
            format={(v) => `${number(v, lang, 0)} %`}
            xLabels={labels}
            markers={marks}
            height={140}
          />
        </ChartCard>
        <ChartCard
          title={t('server.advanced.memory')}
          meta={t('server.advanced.memoryMeta', { peak: formatStorage(peak(mem) ?? 0, lang) })}
          caption={
            status.now.memory.limit
              ? t('server.advanced.memoryCap', {
                  limit: formatStorage(status.now.memory.limit, lang),
                })
              : undefined
          }
        >
          <ServerChart
            label={t('server.chart.label', { metric: t('server.advanced.memory'), range })}
            times={times}
            series={[{ label: t('server.advanced.memory'), tone: 'memory', values: mem }]}
            max={memMax}
            ticks={[0, memMax / 2, memMax]}
            format={(v) => formatStorage(v, lang)}
            xLabels={labels}
            height={140}
          />
        </ChartCard>
      </div>
      <ChartCard
        title={t('server.advanced.latency')}
        meta={t('server.advanced.latencyMeta', { errors: percent(errors ?? 0, lang, 1) })}
        caption={t('server.advanced.latencyCap')}
      >
        <ServerChart
          label={t('server.chart.label', { metric: t('server.advanced.latency'), range })}
          times={times}
          series={[{ label: 'p95', tone: 'cpu', values: lat }]}
          max={latMax}
          ticks={[0, latMax / 2, latMax]}
          format={(v) => `${number(v, lang, 0)} ms`}
          xLabels={labels}
          height={140}
        />
      </ChartCard>
      <ChartCard title={t('server.advanced.networkTitle')} meta={t('server.advanced.networkMeta')}>
        <div className="server-legend">
          <span>
            <i className="server-legend__swatch server-legend__swatch--in" />
            {t('server.advanced.in')}
          </span>
          <span>
            <i className="server-legend__swatch server-legend__swatch--out" />
            {t('server.advanced.out')}
          </span>
        </div>
        <ServerChart
          label={t('server.chart.label', { metric: t('server.advanced.networkTitle'), range })}
          times={times}
          series={[
            { label: t('server.chart.received'), tone: 'in', values: h.map((s) => mbit(s.in)) },
            {
              label: t('server.chart.sent'),
              tone: 'out',
              values: h.map((s) => mbit(s.out)),
              below: true,
            },
          ]}
          max={netMax}
          ticks={[0, netMax / 2, netMax]}
          format={(v) => `${number(v, lang)} Mbit/s`}
          xLabels={labels}
          height={170}
          mirrored
        />
      </ChartCard>
    </>
  );
}

function Transcodes({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const v = status.transcodes;
  return (
    <Card
      title={t('server.advanced.transcodes')}
      action={
        <span className="settings-card__meta">
          {t('server.advanced.transcodesMeta', { active: v.active.length, waiting: v.waiting })}
        </span>
      }
    >
      {v.active.length === 0 ? (
        <p className="settings-card__empty settings-muted">{t('server.videos.empty')}</p>
      ) : (
        <ul className="settings-list">
          {v.active.map((job) => {
            const name = job.name ?? t('server.videos.hidden');
            return (
              <li key={job.assetId}>
                <div className="settings-list__text">
                  <span className={job.name ? 'server-name' : 'server-name server-name--hidden'}>
                    {name}
                    {status.encoder && status.encoder.backend !== 'software' && (
                      <span className="settings-badge settings-badge--accent">
                        {status.encoder.backend.toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="settings-row__help">
                    {[
                      job.source && job.target ? `${job.source} → ${job.target}` : job.target,
                      job.speed !== null
                        ? t('server.advanced.speed', { speed: number(job.speed, lang) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span
                    className="server-bar"
                    role="progressbar"
                    aria-label={name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={job.progress}
                  >
                    <span
                      className="server-bar__fill server-bar__fill--cpu"
                      style={{ width: `${job.progress}%` }}
                    />
                  </span>
                </div>
                <span className="server-pct">
                  {percent(job.progress / 100, lang)}
                  {job.secondsLeft !== null && (
                    <small>~{duration(job.secondsLeft * 1000, lang, 'short')}</small>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="settings-footnote server-foot">
        {t('server.advanced.transcodesFoot', {
          ready: v.readyToday,
          failed: v.failedToday,
          average:
            v.averageSeconds === null ? '—' : duration(v.averageSeconds * 1000, lang, 'short'),
        })}
      </p>
    </Card>
  );
}

function ErrorLog({ status, actions }: { status: ServerStatus; actions: ServerActions }) {
  const { t } = useTranslation();
  const when = useWhen();
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const now = new Date(status.checkedAt).getTime();
  const list = openProblems(status.problems).filter(
    (p) => filter === 'all' || p.severity === 'error',
  );
  return (
    <section id={PROBLEMS_ID} className="server-anchor" data-tour="server-problems">
      <Card title={t('server.advanced.log')}>
        <div className="server-toolbar">
          <Select
            aria-label={t('server.advanced.severity')}
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'errors')}
            options={[
              { value: 'all', label: t('server.advanced.all') },
              { value: 'errors', label: t('server.advanced.errorsOnly') },
            ]}
          />
          <Button onClick={() => void actions.retryAll()} disabled={!list.some((p) => p.retry)}>
            {t('server.advanced.retryAll')}
          </Button>
          <Button
            onClick={() => void actions.seenAll()}
            disabled={!list.some((p) => p.kind !== 'config_check')}
          >
            {t('server.advanced.seenAll')}
          </Button>
          <Button onClick={actions.sendToDevelopers}>{t('server.problems.send')}</Button>
        </div>
        {actions.actionError && (
          <p role="alert" className="settings-error server-error">
            {actions.actionError}
          </p>
        )}
        {list.length === 0 ? (
          <p className="settings-card__empty settings-muted">{t('server.problems.empty')}</p>
        ) : (
          <ul className="settings-list server-log">
            {list.map((p) => (
              <li key={p.id}>
                <span className={`server-sev server-sev--${p.severity}`}>
                  {t(`server.advanced.${p.severity}`)}
                </span>
                <div className="settings-list__text">
                  <span className="settings-row__label">
                    {problemText(t, p).title} <span className="settings-badge">×{p.count}</span>
                  </span>
                  <code className="server-code server-code--inline">
                    {p.technical.replace(/\n/g, ' · ')}
                  </code>
                </div>
                <span className="server-log__when">
                  {when(p.lastAt, now)}
                  {p.retry && (
                    <Button variant="ghost" onClick={() => void actions.retry(p)}>
                      {t('server.problems.retry')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export function AdvancedView({ status, checks, actions }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Summary status={status} checks={checks} actions={actions} />
      <Tiles status={status} />
      <Charts status={status} />
      <div className="server-grid">
        <Transcodes status={status} />
        <Card title={t('server.advanced.queues')}>
          {status.queues.length ? (
            <QueueTable status={status} />
          ) : (
            <p className="settings-card__empty settings-muted">{t('server.advanced.noQueues')}</p>
          )}
        </Card>
      </div>
      <div className="server-grid">
        <Card title={t('server.advanced.processesTitle')}>
          <ProcessTable status={status} advanced />
        </Card>
        <People status={status} advanced />
      </div>
      <ErrorLog status={status} actions={actions} />
    </>
  );
}
