import type {
  DiagnosticCheck,
  ServerProblem,
  ServerRange,
  ServerService,
  ServerStatus,
} from '@inkadra/shared';
import { Avatar, Button, Icon, Select, Switch } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../lib/session.tsx';
import { formatStorage } from '../StorageCharts.tsx';
import { Card, Row } from '../settings-ui.tsx';
import {
  bits,
  downServices,
  duration,
  loadVerdict,
  number,
  openProblems,
  percent,
  speedVerdict,
  storageVerdict,
} from './format.ts';
import { type ServerActions, technicalSummary, useWhen } from './common.ts';
import { HistoryChart } from './charts.tsx';

type Props = { status: ServerStatus; checks: DiagnosticCheck[]; actions: ServerActions };

/** Ids of what an administrator scrolls to from the summary. */
export const PROBLEMS_ID = 'server-problems';

const scrollToProblems = () =>
  document.getElementById(PROBLEMS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Configuration from the checks of the server and of this browser. */
export function configStatus(checks: DiagnosticCheck[]): ServerService['status'] {
  return checks.some((c) => c.status === 'error')
    ? 'down'
    : checks.some((c) => c.status === 'warning')
      ? 'warning'
      : 'ok';
}

/** "Everything works" or what is wrong, with uptime, last backup and open problems (#514). */
function Health({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const down = downServices(status.services);
  const open = openProblems(status.problems).length;
  const now = new Date(status.checkedAt).getTime();
  const first = down[0];
  if (first) {
    const since = first.since ? duration(now - new Date(first.since).getTime(), i18n.language) : null;
    return (
      <section className="server-health server-health--bad" data-tour="server" aria-live="polite">
        <span className="server-health__icon" aria-hidden="true">
          <Icon name="warning" size={20} />
        </span>
        <div className="server-health__text">
          <h3>{t('server.health.bad')}</h3>
          <p>
            {since
              ? t('server.health.downSince', { service: t(`server.services.long.${first.id}`), time: since })
              : t('server.health.down', { service: t(`server.services.long.${first.id}`) })}{' '}
            {t(`server.health.effects.${first.id}`)}
          </p>
        </div>
        <Button onClick={scrollToProblems}>{t('server.health.whatToDo')}</Button>
      </section>
    );
  }
  const backup = status.backup.lastAt
    ? t(`server.health.backup.${status.backup.lastStatus ?? 'none'}`, { when: when(status.backup.lastAt, now) })
    : t('server.health.backup.none');
  return (
    <section className="server-health" data-tour="server" aria-live="polite">
      <span className="server-health__icon" aria-hidden="true">
        <Icon name="check" size={20} />
      </span>
      <div className="server-health__text">
        <h3>{t('server.health.ok')}</h3>
        <p>
          {[
            status.startedAt &&
              t('server.health.uptime', {
                time: duration(now - new Date(status.startedAt).getTime(), i18n.language),
              }),
            backup,
            open ? t('server.health.problems', { count: open }) : t('server.health.noProblems'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {open > 0 && <Button onClick={scrollToProblems}>{t('server.health.seeProblem', { count: open })}</Button>}
    </section>
  );
}

function Meter({
  name,
  verdict,
  warn,
  value,
  bar,
  tone = 'cpu',
  hint,
}: {
  name: string;
  verdict: string | null;
  warn?: boolean;
  value: ReactNode;
  bar?: number | null;
  tone?: 'cpu' | 'memory' | 'ok';
  hint: ReactNode;
}) {
  return (
    <div className="server-meter">
      <div className="server-meter__top">
        <span className="server-meter__name">{name}</span>
        {verdict && (
          <span className={warn ? 'server-verdict server-verdict--warn' : 'server-verdict'}>
            {verdict}
          </span>
        )}
      </div>
      <div className="server-meter__value">{value}</div>
      {bar !== undefined && bar !== null && (
        <span className="server-bar" aria-hidden="true">
          <span
            className={`server-bar__fill server-bar__fill--${tone}`}
            style={{ width: `${Math.min(100, Math.max(0, bar * 100))}%` }}
          />
        </span>
      )}
      <div className="server-meter__hint">{hint}</div>
    </div>
  );
}

function Meters({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const lang = i18n.language;
  const { cpu, memory, network, responses } = status.now;
  const cpuShare = cpu.cores ? cpu.used / cpu.cores : 0;
  const memShare = memory.limit ? memory.used / memory.limit : 0;
  const store = status.storage;
  const space = storageVerdict(store);
  const speed = speedVerdict(responses.p95);
  const now = new Date(status.checkedAt).getTime();
  const b = status.backup;
  const backupKey = !b.lastStatus ? (b.enabled ? 'none' : 'off') : b.lastStatus;
  return (
    <section className="server-meters" aria-label={t('server.meters.label')}>
      <Meter
        name={t('server.meters.cpu.name')}
        verdict={t(`server.meters.cpu.${loadVerdict(cpuShare)}`)}
        warn={loadVerdict(cpuShare) === 'high'}
        value={
          <>
            {number(cpuShare * 100, lang, 0)}
            <small> %</small>
          </>
        }
        bar={cpuShare}
        hint={t('server.meters.cpu.hint')}
      />
      <Meter
        name={t('server.meters.memory.name')}
        verdict={t(`server.meters.memory.${loadVerdict(memShare)}`)}
        warn={loadVerdict(memShare) === 'high'}
        value={
          <>
            {formatStorage(memory.used, lang)}
            {memory.limit && <small> {t('server.meters.of', { total: formatStorage(memory.limit, lang) })}</small>}
          </>
        }
        bar={memory.limit ? memShare : null}
        tone="memory"
        hint={t('server.meters.memory.hint')}
      />
      {store.total !== null ? (
        <Meter
          name={t('server.meters.storage.name')}
          verdict={
            space.key === 'unknown' ? null : t(`server.meters.storage.${space.key}`, { count: space.months ?? 0 })
          }
          warn={space.key === 'almostFull'}
          value={
            <>
              {formatStorage(store.used, lang)}
              <small> {t('server.meters.of', { total: formatStorage(store.total, lang) })}</small>
            </>
          }
          bar={store.used / store.total}
          hint={t('server.meters.storage.split', {
            originals: formatStorage(store.originals, lang),
            derived: formatStorage(store.copies + store.previews, lang),
          })}
        />
      ) : (
        <Meter
          name={t('server.meters.storage.name')}
          verdict={t('server.meters.storage.bucket')}
          value={
            <>
              {formatStorage(store.used, lang)}
              <small> {t('server.meters.storage.used')}</small>
            </>
          }
          hint={[
            t('server.meters.storage.s3Hint'),
            store.growthPerMonth
              ? t('server.meters.storage.growth', { size: formatStorage(store.growthPerMonth, lang) })
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        />
      )}
      <Meter
        name={t('server.meters.network.name')}
        verdict={network ? t('server.meters.network.normal') : t('server.meters.network.unknown')}
        value={
          network ? (
            <>
              <span aria-hidden="true">↓</span>
              <span className="ink-sr-only">{t('server.meters.network.in')}</span> {bits(network.in, lang)}{' '}
              <span aria-hidden="true">↑</span>
              <span className="ink-sr-only">{t('server.meters.network.out')}</span> {bits(network.out, lang)}
            </>
          ) : (
            '—'
          )
        }
        hint={t('server.meters.network.hint')}
      />
      <Meter
        name={t('server.meters.speed.name')}
        verdict={t(`server.meters.speed.${speed}`)}
        warn={speed === 'verySlow'}
        value={
          responses.p95 === null ? (
            '—'
          ) : (
            <>
              {number(responses.p95 / 1000, lang, 2)}
              <small> {t('server.meters.speed.unit')}</small>
            </>
          )
        }
        bar={responses.p95 === null ? null : Math.min(1, responses.p95 / 1000)}
        tone="ok"
        hint={t('server.meters.speed.hint')}
      />
      <Meter
        name={t('server.meters.backup.name')}
        verdict={t(`server.meters.backup.${backupKey}`)}
        warn={backupKey === 'failed' || backupKey === 'none'}
        value={<span className="server-meter__value--text">{b.lastAt ? when(b.lastAt, now) : '—'}</span>}
        hint={
          <>
            {[
              b.size !== null ? formatStorage(b.size, lang) : null,
              b.nextAt ? t('server.meters.backup.next', { when: when(b.nextAt, now) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {(b.size !== null || b.nextAt) && ' · '}
            <Link to="/settings?section=backups" replace>
              {t('backups.title')}
            </Link>
          </>
        }
      />
    </section>
  );
}

/** One line of a list: the state, what it is, and its detail. */
function ServiceRow({
  ok,
  name,
  detail,
  state,
}: {
  ok: 'ok' | 'warning' | 'down' | 'off';
  name: string;
  detail: ReactNode;
  state: ReactNode;
}) {
  return (
    <li className="server-service">
      <span className={`server-service__icon server-service__icon--${ok}`} aria-hidden="true">
        <Icon name={ok === 'ok' ? 'check' : ok === 'off' ? 'minus' : 'warning'} size={14} />
      </span>
      <div className="settings-list__text">
        <span className="settings-row__label">{name}</span>
        <span className="settings-row__help">{detail}</span>
      </div>
      <span className={`server-service__state server-service__state--${ok}`}>{state}</span>
    </li>
  );
}

function Services({ status, checks }: { status: ServerStatus; checks: DiagnosticCheck[] }) {
  const { t, i18n } = useTranslation();
  const now = new Date(status.checkedAt).getTime();
  const service = (id: ServerService['id']) => status.services.find((s) => s.id === id);
  const db = service('database');
  const queue = service('queue');
  const config = configStatus(checks);
  const failing = checks.filter((c) => c.status !== 'ok').length;
  const rows: Array<{ id: string; ok: ServerService['status']; detail: ReactNode }> = (
    ['web', 'collab', 'worker'] as const
  ).map((id) => {
    const s = service(id);
    const signal = s?.since
      ? t('server.services.lastSignal', {
          time: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'short' }).format(
            Math.min(0, Math.round((new Date(s.since).getTime() - now) / 1000)),
            'second',
          ),
        })
      : null;
    return {
      id,
      ok: s?.status ?? 'off',
      detail: [t(`server.roles.${id}`), id !== 'web' && signal].filter(Boolean).join(' · '),
    };
  });
  const dbOk: ServerService['status'] =
    db?.status === 'down' || queue?.status === 'down' ? 'down' : 'ok';
  const down = downServices(status.services).length;
  return (
    <Card
      title={t('server.services.title')}
      action={
        <span className="settings-card__meta">
          {down ? t('server.services.someDown', { count: down }) : t('server.services.allOk')}
        </span>
      }
    >
      <ul className="settings-list">
        {rows.map((r) => (
          <ServiceRow
            key={r.id}
            ok={r.ok}
            name={t(`server.services.names.${r.id}`)}
            detail={r.detail}
            state={t(`server.services.status.${r.ok}`)}
          />
        ))}
        <ServiceRow
          ok={dbOk}
          name={t('server.services.names.database')}
          detail={[db?.detail, queue?.detail].filter(Boolean).join(' · ') || '—'}
          state={t(`server.services.status.${dbOk}`)}
        />
        <ServiceRow
          ok={config}
          name={t('server.services.names.configuration')}
          detail={t('server.services.configuration')}
          state={
            failing
              ? t('server.services.checksFailing', { count: failing })
              : t('server.services.checksPassed', { count: checks.length })
          }
        />
      </ul>
      <details className="server-tech">
        <summary>{t('server.services.checks')}</summary>
        <ul className="settings-list">
          {checks.map((c) => (
            <li key={c.id}>
              <div className="settings-list__text">
                <span className="settings-row__label">{t(`diagnostics.checks.${c.id}.title`)}</span>
                {c.status !== 'ok' && (
                  <span className="settings-row__help">{t(`diagnostics.checks.${c.id}.fix`)}</span>
                )}
                {(c.expected || c.actual) && (
                  <code className="settings-env">
                    {[c.expected && `${t('diagnostics.expected')}: ${c.expected}`, c.actual && `${t('diagnostics.actual')}: ${c.actual}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </code>
                )}
              </div>
              <span className={`server-service__state server-service__state--${c.status === 'error' ? 'down' : c.status}`}>
                {t(`diagnostics.status.${c.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

const SIMPLE_RANGES: ServerRange[] = ['1h', '24h', '7d'];

function Trend({ status, actions }: { status: ServerStatus; actions: ServerActions }) {
  const { t } = useTranslation();
  return (
    <Card
      title={t('server.chart.title')}
      action={
        <Select
          aria-label={t('server.chart.period')}
          variant="quiet"
          value={SIMPLE_RANGES.includes(actions.range) ? actions.range : '1h'}
          onChange={(v) => actions.setRange(v as ServerRange)}
          options={SIMPLE_RANGES.map((r) => ({ value: r, label: t(`server.chart.ranges.${r}`) }))}
        />
      }
    >
      <HistoryChart status={status} />
    </Card>
  );
}

function Videos({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const v = status.transcodes;
  return (
    <Card
      title={t('server.videos.title')}
      body={t('server.videos.lead')}
      action={
        <span className="settings-card__meta">
          {t('server.videos.meta', { waiting: v.waiting, ready: v.readyToday })}
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
                  <span className={job.name ? 'server-name' : 'server-name server-name--hidden'}>{name}</span>
                  <span className="settings-row__help">
                    {job.secondsLeft !== null
                      ? t('server.videos.progress', {
                          percent: percent(job.progress / 100, i18n.language),
                          time: duration(job.secondsLeft * 1000, i18n.language),
                        })
                      : percent(job.progress / 100, i18n.language)}
                  </span>
                  <span
                    className="server-bar"
                    role="progressbar"
                    aria-label={name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={job.progress}
                  >
                    <span className="server-bar__fill server-bar__fill--cpu" style={{ width: `${job.progress}%` }} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function People({ status, advanced = false }: { status: ServerStatus; advanced?: boolean }) {
  const { t, i18n } = useTranslation();
  const now = new Date(status.checkedAt).getTime();
  const p = status.presence;
  const counts = t('server.people.meta', {
    people: t('server.people.people', { count: p.people }),
    boards: t('server.people.boards', { count: p.boards.length }),
  });
  return (
    <Card
      title={t(advanced ? 'server.advanced.people' : 'server.people.title')}
      action={
        <span className="settings-card__meta">
          {advanced && p.peak !== null ? `${counts} · ${t('server.people.peak', { value: p.peak })}` : counts}
        </span>
      }
    >
      {p.boards.length === 0 ? (
        <p className="settings-card__empty settings-muted">{t('server.people.empty')}</p>
      ) : (
        <ul className="settings-list">
          {p.boards.map((b, i) => (
            <li key={b.boardId ?? `hidden-${i}`}>
              <div className="settings-list__text">
                <span className={b.title ? 'server-name' : 'server-name server-name--hidden'}>
                  {b.title ?? t(advanced ? 'server.people.hiddenShort' : 'server.people.hidden')}
                </span>
                <span className="settings-row__help">
                  {[b.projectName, t('server.people.since', { time: duration(now - new Date(b.since).getTime(), i18n.language) })]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="server-avatars">
                {b.people.length > 0 ? (
                  b.people.slice(0, 4).map((u) => <Avatar key={u.id} name={u.name} image={u.image} size={24} />)
                ) : (
                  <span className="server-count" aria-label={t('server.people.people', { count: b.count })}>
                    {b.count}
                  </span>
                )}
                {b.people.length > 4 && <span className="server-count">+{b.people.length - 4}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A problem in plain words: what happened, which file, and what it means (#514). */
export function problemText(t: (key: string, values?: Record<string, unknown>) => string, p: ServerProblem) {
  const kind = KINDS.has(p.kind) ? p.kind : 'unknown';
  const title = t(`server.problems.kinds.${kind}.title`);
  const text =
    p.kind === 'config_check' && p.checkId
      ? t(`diagnostics.checks.${p.checkId}.fix`)
      : t(`server.problems.kinds.${kind}.text`, {
          service: p.service ? t(`server.services.long.${p.service}`) : '',
        });
  const where = p.file
    ? p.board
      ? t('server.problems.fileOnBoard', { file: p.file, board: p.board })
      : t('server.problems.file', { file: p.file })
    : null;
  return { title, text, where };
}

const KINDS = new Set([
  'video_failed',
  'preview_failed',
  'office_failed',
  'email_failed',
  'transfer_failed',
  'job_failed',
  'backup_failed',
  'disk_full',
  'service_down',
  'server_error',
  'config_check',
]);

function Problems({ status, actions }: { status: ServerStatus; actions: ServerActions }) {
  const { t } = useTranslation();
  const when = useWhen();
  const open = openProblems(status.problems);
  const now = new Date(status.checkedAt).getTime();
  return (
    <section id={PROBLEMS_ID} className="server-anchor" data-tour="server-problems">
      <Card
        title={t('server.problems.title')}
        action={
          <span className="server-card-actions">
            <span className="settings-card__meta">{t('server.problems.period')}</span>
            <Button onClick={actions.sendToDevelopers}>{t('server.problems.send')}</Button>
          </span>
        }
      >
        {actions.actionError && (
          <p role="alert" className="settings-error server-error">
            {actions.actionError}
          </p>
        )}
        {open.length === 0 ? (
          <p className="settings-card__empty settings-muted">{t('server.problems.empty')}</p>
        ) : (
          <ul className="settings-list">
            {open.map((p) => {
              const text = problemText(t, p);
              return (
                <li key={p.id} className="server-problem">
                  <span className="server-problem__icon" aria-hidden="true">
                    <Icon name="warning" size={14} />
                  </span>
                  <div className="settings-list__text">
                    <span className="settings-row__label">
                      {text.title}
                      {p.count > 1 && <span className="settings-badge">{t('server.problems.times', { count: p.count })}</span>}
                    </span>
                    <span className="settings-row__help">
                      {[text.where, text.text].filter(Boolean).join(' ')}
                    </span>
                    <details className="server-tech">
                      <summary>{t('server.problems.technical')}</summary>
                      <code className="server-code">{`${p.role} · ${when(p.lastAt, now)}\n${p.technical}`}</code>
                    </details>
                  </div>
                  {p.kind !== 'config_check' && (
                    <span className="server-problem__actions">
                      {p.retry && <Button onClick={() => void actions.retry(p)}>{t('server.problems.retry')}</Button>}
                      <Button variant="ghost" onClick={() => void actions.seen(p)}>
                        {t('server.problems.seen')}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

export function Alerts({ status, actions }: { status: ServerStatus; actions: ServerActions }) {
  const { t } = useTranslation();
  const { instance } = useSession();
  const mail = instance?.auth.email === true;
  return (
    <Card title={t('server.alerts.title')} tour="server-alerts">
      <div className="settings-rows">
        <Row label={t('server.alerts.enabled')} help={t('server.alerts.enabledHelp')}>
          <Switch
            aria-label={t('server.alerts.enabled')}
            checked={status.alerts.enabled}
            onChange={(e) => void actions.saveAlerts({ enabled: e.target.checked })}
          />
        </Row>
        <Row
          label={t('server.alerts.how')}
          help={mail ? t('server.alerts.howHelp') : t('server.alerts.noEmail')}
        >
          <Select
            aria-label={t('server.alerts.how')}
            value={status.alerts.email && mail ? 'email' : 'inbox'}
            disabled={!status.alerts.enabled || !mail}
            onChange={(v) => void actions.saveAlerts({ email: v === 'email' })}
            options={[
              { value: 'inbox', label: t('server.alerts.inbox') },
              { value: 'email', label: t('server.alerts.email') },
            ]}
          />
        </Row>
      </div>
    </Card>
  );
}

function TechnicalDetails({ status, checks }: { status: ServerStatus; checks: DiagnosticCheck[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const p95 = status.now.responses.p95;
  const errors = status.now.responses.errors;
  const encoder = status.encoder;
  return (
    <details className="server-more">
      <summary>
        <span className="settings-list__text">
          <span className="settings-row__label">{t('server.details.title')}</span>
          <span className="settings-row__help">{t('server.details.lead')}</span>
        </span>
        <Icon name="chevronRight" size={14} />
      </summary>
      <div className="server-more__body">
        <dl className="server-kv">
          <dt>{t('server.details.version')}</dt>
          <dd>
            {status.version}
            {status.image && (
              <>
                {' · '}
                <code className="settings-env">{`ghcr.io/inkadra/inkadra:${status.version}${status.image === 'standard' ? '' : `-${status.image}`}`}</code>
              </>
            )}
          </dd>
          <dt>{t('server.details.encoding')}</dt>
          <dd>
            {!encoder
              ? t('server.details.encoder.none')
              : encoder.backend === 'software'
                ? t('server.details.encoder.software')
                : t('server.details.encoder.hardware', { label: encoder.label })}
          </dd>
          <dt>{t('server.details.database')}</dt>
          <dd>
            {[
              status.database.version,
              status.database.size !== null ? formatStorage(status.database.size, lang) : null,
              status.database.connections !== null
                ? t('server.details.connections', { count: status.database.connections })
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
          <dt>{t('server.details.responses')}</dt>
          <dd>
            {p95 === null
              ? '—'
              : t('server.details.responsesValue', {
                  p95: `${number(p95, lang, 0)} ms`,
                  errors: percent(errors ?? 0, lang, 1),
                })}
          </dd>
          <dt>{t('server.details.files')}</dt>
          <dd>
            {t(`server.details.driver.${status.storage.driver}`)} ·{' '}
            <code className="settings-env">{status.storage.location}</code>
          </dd>
        </dl>
        <ProcessTable status={status} />
        <QueueTable status={status} />
        <div>
          <Button
            icon="copy"
            onClick={() => void navigator.clipboard?.writeText(technicalSummary(status, checks))}
          >
            {t('server.details.copy')}
          </Button>
        </div>
      </div>
    </details>
  );
}

export function ProcessTable({ status, advanced = false }: { status: ServerStatus; advanced?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = new Date(status.checkedAt).getTime();
  return (
    <div className="server-table-wrap">
      <table className="server-table">
        <thead>
          <tr>
            <th scope="col">{t('server.details.process')}</th>
            <th scope="col" className="server-table__n">
              {t('server.details.cpu')}
            </th>
            <th scope="col" className="server-table__n">
              {t('server.details.memory')}
            </th>
            <th scope="col" className="server-table__n">
              {advanced ? t('server.details.signal') : t('server.details.uptime')}
            </th>
          </tr>
        </thead>
        <tbody>
          {status.processes.map((p) => (
            <tr key={`${p.role}@${p.host}`}>
              <th scope="row">
                <span className={`server-dot server-dot--${p.status}`} aria-hidden="true" />
                {t(`server.roles.${p.role}`)}
                <span className="ink-sr-only"> · {t(`server.services.status.${p.status === 'ok' ? 'ok' : p.status === 'late' ? 'warning' : 'down'}`)}</span>
              </th>
              <td className="server-table__n">
                {p.cpu === null || !status.now.cpu.cores ? '—' : percent(p.cpu / status.now.cpu.cores, lang)}
              </td>
              <td className="server-table__n">{p.memory === null ? '—' : formatStorage(p.memory, lang)}</td>
              <td className="server-table__n">
                {advanced
                  ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(
                      Math.min(0, Math.round((new Date(p.lastSeenAt).getTime() - now) / 1000)),
                      'second',
                    )
                  : duration(now - new Date(p.startedAt).getTime(), lang, 'short')}
              </td>
            </tr>
          ))}
          {advanced && status.database.version && (
            <tr>
              <th scope="row">
                <span className="server-dot server-dot--ok" aria-hidden="true" />
                {status.database.version}
              </th>
              <td className="server-table__n">—</td>
              <td className="server-table__n">
                {status.database.size !== null ? formatStorage(status.database.size, lang) : '—'}
              </td>
              <td className="server-table__n">{t('server.services.status.ok')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function QueueTable({ status }: { status: ServerStatus }) {
  const { t } = useTranslation();
  if (!status.queues.length) return null;
  return (
    <div className="server-table-wrap">
      <table className="server-table">
        <thead>
          <tr>
            <th scope="col">{t('server.details.queue')}</th>
            <th scope="col" className="server-table__n">
              {t('server.details.waiting')}
            </th>
            <th scope="col" className="server-table__n">
              {t('server.details.active')}
            </th>
            <th scope="col" className="server-table__n">
              {t('server.details.failed')}
            </th>
          </tr>
        </thead>
        <tbody>
          {status.queues.map((q) => (
            <tr key={q.id}>
              <th scope="row">{t(`server.details.queues.${q.id}`)}</th>
              <td className="server-table__n">{q.waiting}</td>
              <td className="server-table__n">{q.active}</td>
              <td className={q.failed24h ? 'server-table__n server-table__fail' : 'server-table__n'}>{q.failed24h}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimpleView({ status, checks, actions }: Props) {
  return (
    <>
      <Health status={status} />
      <Meters status={status} />
      <Services status={status} checks={checks} />
      <Trend status={status} actions={actions} />
      <Videos status={status} />
      <People status={status} />
      <Problems status={status} actions={actions} />
      <Alerts status={status} actions={actions} />
      <TechnicalDetails status={status} checks={checks} />
    </>
  );
}
