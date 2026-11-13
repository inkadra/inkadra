import type { DiagnosticCheck, ServerRange, ServerStatus } from '@inkadra/shared';
import { Button, Icon, Segmented } from '@inkadra/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatStorage } from '../StorageCharts.tsx';
import { Card } from '../settings-ui.tsx';
import { chartSpan, markers, mbit, xLabels } from './charts.ts';
import { type ServerActions, usePeek, useWhen } from './common.ts';
import {
  ago,
  bits,
  cpuScale,
  diskCompresses,
  duration,
  memoryScale,
  niceMax,
  number,
  openProblems,
  percent,
} from './format.ts';
import { ServerChart } from './ServerChart.tsx';
import {
  Alerts,
  People,
  PROBLEMS_ID,
  ProcessTable,
  problemText,
  QueueTable,
  ShareBar,
  StatusCard,
  scrollToItem,
} from './SimpleView.tsx';

type Props = { status: ServerStatus; checks: DiagnosticCheck[]; actions: ServerActions };

const RANGES: ServerRange[] = ['15m', '1h', '24h', '7d'];

const known = (values: Array<number | null>) => values.filter((v): v is number => v !== null);
const mean = (values: Array<number | null>) => {
  const k = known(values);
  return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
};
const peak = (values: Array<number | null>) => {
  const k = known(values);
  return k.length ? Math.max(...k) : null;
};

/** "updated 3 s ago", counted every second while the page is on screen. */
function Updated({ at }: { at: number | null }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  if (at === null) return null;
  return (
    <span className="settings-card__meta server-updated">
      {t('server.advanced.updated', {
        time: ago(new Date(at).toISOString(), Math.max(now, at), i18n.language),
      })}
    </span>
  );
}

/** One measure: its name, the value of now, mean and peak, then its curve. */
function TrendCell({
  name,
  meta,
  value,
  hint,
  children,
}: {
  name: string;
  meta: string;
  value: ReactNode;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="server-cell server-cell--trend">
      <div className="server-cell__head">
        <span className="server-cell__name">{name}</span>
        <span className="server-cell__meta">{meta}</span>
      </div>
      <div className="server-value">{value}</div>
      <div className="server-hint">{hint}</div>
      {children}
    </div>
  );
}

/** CPU, memory, response times and network: the value of now on top of its curve. */
function Trend({ status, actions }: { status: ServerStatus; actions: ServerActions }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const h = status.history;
  const times = h.map((s) => s.t);
  const span = chartSpan(status);
  const labels = xLabels(t, status.range);
  const range = t(`server.chart.ranges.${status.range}`);
  const { cpu, memory, network, responses } = status.now;
  const cpuNow = cpu.cores ? (cpu.used / cpu.cores) * 100 : null;
  const cpuValues = h.map((s) => s.cpu);
  const memValues = h.map((s) => s.memory);
  const lat = h.map((s) => s.p95);
  const pct = (v: number | null) => (v === null ? '—' : `${number(v, lang, 0)} %`);
  const cpuMax = cpuScale([...cpuValues, cpuNow]);
  const mem = memoryScale([...memValues, memory.used], memory.limit);
  const memPeak = Math.max(peak(memValues) ?? 0, memory.used);
  const memShare = memory.limit ? memory.used / memory.limit : null;
  const latMax = niceMax(Math.max(100, ...known(lat)));
  const netMax = niceMax(Math.max(1, ...h.flatMap((s) => [mbit(s.in) ?? 0, mbit(s.out) ?? 0])));
  const errors = mean(h.map((s) => s.errors)) ?? responses.errors ?? 0;
  const label = (metric: string) => t('server.chart.label', { metric, range });
  const axis = (max: number) => [0, max / 2, max];
  return (
    <Card
      title={t('server.chart.title')}
      tour="server-health"
      className="server-card-wrap"
      action={
        <span className="server-card-actions">
          <Updated at={actions.updatedAt} />
          <Segmented
            label={t('server.advanced.range')}
            value={actions.range}
            onChange={actions.setRange}
            options={RANGES.map((r) => ({ value: r, label: t(`server.advanced.ranges.${r}`) }))}
          />
        </span>
      }
    >
      <div className="server-cells server-cells--2">
        <TrendCell
          name={t('server.advanced.cpu')}
          meta={t('server.advanced.cores', { count: Math.round(cpu.cores * 10) / 10 })}
          value={
            <>
              {cpuNow === null ? '—' : number(cpuNow, lang, 0)} <small>%</small>
            </>
          }
          hint={t('server.advanced.cpuMeta', {
            avg: pct(mean(cpuValues)),
            peak: pct(peak(cpuValues)),
          })}
        >
          <ServerChart
            label={label(t('server.advanced.cpu'))}
            times={times}
            span={span}
            series={[{ label: t('server.advanced.cpu'), tone: 'cpu', values: cpuValues }]}
            max={cpuMax}
            ticks={axis(cpuMax)}
            format={(v) => `${number(v, lang, 0)} %`}
            xLabels={labels}
            markers={markers(t, status)}
          />
        </TrendCell>
        <TrendCell
          name={t('server.advanced.memory')}
          meta={
            memory.limit
              ? t('server.advanced.limit', { size: formatStorage(memory.limit, lang) })
              : ''
          }
          value={formatStorage(memory.used, lang)}
          hint={
            <>
              {t('server.advanced.memoryMeta', { peak: formatStorage(memPeak, lang) })}
              {memShare !== null && (
                <>
                  {' · '}
                  <span className={memShare >= 0.8 ? 'server-warn' : undefined}>
                    {t('server.advanced.ofLimit', { share: percent(memShare, lang, 1) })}
                  </span>
                </>
              )}
            </>
          }
        >
          <ServerChart
            label={label(t('server.advanced.memory'))}
            times={times}
            span={span}
            series={[{ label: t('server.advanced.memory'), tone: 'memory', values: memValues }]}
            max={mem.max}
            ticks={axis(mem.max)}
            format={(v) => (v === 0 ? '0' : formatStorage(v, lang))}
            xLabels={labels}
            {...(mem.limit ? { limit: t('server.advanced.limitLine') } : {})}
          />
        </TrendCell>
        <TrendCell
          name={t('server.advanced.latency')}
          meta={t('server.advanced.latencyMeta', { errors: percent(errors, lang, 1) })}
          value={
            responses.p95 === null ? (
              '—'
            ) : (
              <>
                {number(responses.p95, lang, 0)} <small>ms</small>
              </>
            )
          }
          hint={t('server.advanced.latencyHint')}
        >
          <ServerChart
            label={label(t('server.advanced.latency'))}
            times={times}
            span={span}
            series={[{ label: 'p95', tone: 'cpu', values: lat }]}
            max={latMax}
            ticks={axis(latMax)}
            format={(v) => (v === 0 ? '0' : `${number(v, lang, 0)} ms`)}
            xLabels={labels}
          />
        </TrendCell>
        <TrendCell
          name={t('server.advanced.network')}
          meta={t('server.advanced.networkOnly')}
          value={
            network ? (
              <span className="server-value--pair">
                <span>
                  <i className="server-swatch server-swatch--in" />
                  <span aria-hidden="true">↓</span>
                  <span className="ink-sr-only">{t('server.meters.network.in')}</span>{' '}
                  {bits(network.in, lang)}
                </span>
                <span>
                  <i className="server-swatch server-swatch--out" />
                  <span aria-hidden="true">↑</span>
                  <span className="ink-sr-only">{t('server.meters.network.out')}</span>{' '}
                  {bits(network.out, lang)}
                </span>
              </span>
            ) : (
              '—'
            )
          }
          hint={
            network
              ? t('server.advanced.today', {
                  in: formatStorage(network.todayIn, lang),
                  out: formatStorage(network.todayOut, lang),
                })
              : t('server.meters.network.unknown')
          }
        >
          <ServerChart
            label={label(t('server.advanced.network'))}
            times={times}
            span={span}
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
            ticks={axis(netMax)}
            format={(v) => (v === 0 ? '0' : `${number(v, lang)} Mb/s`)}
            xLabels={labels}
            mirrored
          />
        </TrendCell>
      </div>
      {h.length === 0 && (
        <p className="settings-card__empty settings-muted">{t('server.chart.empty')}</p>
      )}
    </Card>
  );
}

/** The space has no curve: four equal cells, the compression note at the bottom. */
function Space({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const store = status.storage;
  const share = store.total ? store.used / store.total : null;
  const cell = (label: string, value: number, hint: ReactNode, extra?: ReactNode) => {
    const [n, unit] = formatStorage(value, lang).split(/\s(?=\S+$)/);
    return (
      <div className="server-cell">
        <span className="server-cell__label">{label}</span>
        <div className="server-value">
          {n} {unit && <small>{unit}</small>}
        </div>
        {extra}
        <div className="server-hint">{hint}</div>
      </div>
    );
  };
  return (
    <Card
      title={t('server.advanced.storage')}
      action={
        <span className="settings-card__meta server-ellipsis">
          {store.driver} · {store.location}
        </span>
      }
    >
      <div className="server-cells">
        {cell(
          t('server.advanced.space.used'),
          store.used,
          store.total !== null && share !== null
            ? t('server.advanced.space.of', {
                total: formatStorage(store.total, lang),
                share: percent(share, lang, 1),
              })
            : t('server.meters.storage.bucket'),
          share !== null && (
            <ShareBar
              share={share}
              label={t('server.how.space.bar')}
              text={percent(share, lang, 1)}
              warn={share >= 0.9}
            />
          ),
        )}
        {cell(
          t('server.advanced.space.originals'),
          store.originals,
          t('server.advanced.space.originalsHint'),
        )}
        {cell(
          t('server.advanced.space.copies'),
          store.copies,
          t('server.advanced.space.copiesHint'),
        )}
        {cell(
          t('server.advanced.space.previews'),
          store.previews,
          t('server.advanced.space.previewsHint'),
        )}
      </div>
      {diskCompresses(store) && (
        <p className="settings-footnote server-card-foot">
          {t('server.meters.storage.compressed')}
        </p>
      )}
    </Card>
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
                <span className="server-thumb" aria-hidden="true">
                  {job.thumbnailUrl ? (
                    <img src={job.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Icon name="film" size={16} />
                  )}
                </span>
                <div className="settings-list__text">
                  <span className={job.name ? 'server-name' : 'server-name server-name--hidden'}>
                    <span className="server-ellipsis">{name}</span>
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
                  <ShareBar share={job.progress / 100} label={name} text={`${job.progress} %`} />
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
      <p className="settings-footnote server-card-foot">
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
  const peeked = usePeek();
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const items = useRef(new Map<string, HTMLLIElement>());
  const now = new Date(status.checkedAt).getTime();
  const list = openProblems(status.problems).filter(
    (p) => filter === 'all' || p.severity === 'error',
  );
  // From "Technical details in Advanced": to that entry, highlighted and focused.
  useEffect(() => {
    if (!peeked) return;
    const item = items.current.get(peeked);
    if (!item) return;
    scrollToItem(item, 'center');
    item.focus({ preventScroll: true });
  }, [peeked]);
  return (
    <section id={PROBLEMS_ID} className="server-anchor" data-tour="server-problems">
      <Card
        title={t('server.advanced.log')}
        className="server-card-wrap"
        action={
          <span className="server-card-actions">
            <span className="settings-card__meta server-hide-phone">
              {t('server.problems.period')}
            </span>
            <Button onClick={actions.sendToDevelopers}>{t('server.problems.send')}</Button>
          </span>
        }
      >
        <div className="server-toolbar">
          <Segmented
            label={t('server.advanced.severity')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('server.advanced.all') },
              { value: 'errors', label: t('server.advanced.errorsOnly') },
            ]}
          />
          <span className="server-toolbar__end">
            <Button onClick={() => void actions.retryAll()} disabled={!list.some((p) => p.retry)}>
              {t('server.advanced.retryAll')}
            </Button>
            <Button
              onClick={() => void actions.seenAll()}
              disabled={!list.some((p) => p.kind !== 'config_check')}
            >
              {t('server.advanced.seenAll')}
            </Button>
          </span>
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
            {list.map((p) => {
              const title = problemText(t, p).title;
              const found = p.id === peeked;
              return (
                <li
                  key={p.id}
                  ref={(el) => {
                    if (el) items.current.set(p.id, el);
                    else items.current.delete(p.id);
                  }}
                  className={found ? 'server-log__found' : undefined}
                  tabIndex={found ? -1 : undefined}
                  aria-current={found ? 'true' : undefined}
                >
                  <span className={`server-sev server-sev--${p.severity}`}>
                    {t(`server.advanced.${p.severity}`)}
                  </span>
                  <div className="settings-list__text">
                    <span className="settings-row__label">
                      {title} <span className="settings-badge">×{p.count}</span>
                    </span>
                    <code className="server-code">{p.technical.replace(/\n/g, ' · ')}</code>
                  </div>
                  <span className="server-log__when">
                    {when(p.lastAt, now)}
                    {p.retry && (
                      <Button
                        variant="ghost"
                        aria-label={t('server.problems.retryNamed', { title })}
                        onClick={() => void actions.retry(p)}
                      >
                        {t('server.problems.retry')}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
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
      <StatusCard status={status} checks={checks} advanced />
      <Trend status={status} actions={actions} />
      <Space status={status} />
      <div className="server-pair">
        <Transcodes status={status} />
        <People status={status} advanced />
      </div>
      <div className="server-pair">
        <Card title={t('server.advanced.queues')}>
          {status.queues.length ? (
            <QueueTable status={status} />
          ) : (
            <p className="settings-card__empty settings-muted">{t('server.advanced.noQueues')}</p>
          )}
        </Card>
        <Card title={t('server.advanced.processesTitle')}>
          <ProcessTable status={status} />
        </Card>
      </div>
      <ErrorLog status={status} actions={actions} />
      <Alerts status={status} actions={actions} />
    </>
  );
}
