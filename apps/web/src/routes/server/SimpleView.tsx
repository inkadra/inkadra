import type { DiagnosticCheck, ServerProblem, ServerStatus } from '@inkadra/shared';
import { Avatar, Button, Icon, Select, Switch } from '@inkadra/ui';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { updatePreferences } from '../../lib/preferences.ts';
import { useSession } from '../../lib/session.tsx';
import { formatStorage } from '../StorageCharts.tsx';
import { Card, Row, Summary } from '../settings-ui.tsx';
import { peekProblem, type ServerActions, technicalSummary, useWhen } from './common.ts';
import {
  diskCompresses,
  duration,
  type Health,
  healthOf,
  number,
  openProblems,
  percent,
  sortedProblems,
  speedVerdict,
  storageVerdict,
} from './format.ts';

type Props = { status: ServerStatus; checks: DiagnosticCheck[]; actions: ServerActions };

/** Ids of what an administrator scrolls to from the status card. */
export const PROBLEMS_ID = 'server-problems';

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Scrolls the settings window's body only: `scrollIntoView` would also move the window inside
 * the page. Elsewhere (tests, a page without the window) it falls back to `scrollIntoView`.
 */
export function scrollToItem(item: HTMLElement | null, block: 'start' | 'center') {
  if (!item) return;
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  const box = item.closest<HTMLElement>('.settings-window__body');
  if (!box) {
    item.scrollIntoView({ behavior, block });
    return;
  }
  const offset = item.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const room = block === 'center' ? (box.clientHeight - item.offsetHeight) / 2 : 12;
  box.scrollTo({ top: box.scrollTop + offset - Math.max(0, room), behavior });
}

const scrollToProblems = () => scrollToItem(document.getElementById(PROBLEMS_ID), 'start');

/** The sentence and the button of the status card, from its verdict. */
function verdict(
  t: (key: string, values?: Record<string, unknown>) => string,
  health: Health,
  status: ServerStatus,
  checks: DiagnosticCheck[],
  when: (iso: string, now?: number) => string,
  lang: string,
) {
  const now = new Date(status.checkedAt).getTime();
  const open = openProblems(status.problems).length;
  if (health.level === 'bad') {
    const service = t(`server.services.long.${health.service.id}`);
    const since = health.service.since
      ? duration(now - new Date(health.service.since).getTime(), lang)
      : null;
    return {
      tone: 'danger' as const,
      icon: 'warning' as const,
      title: t('server.health.bad'),
      text: `${
        since
          ? t('server.health.downSince', { service, time: since })
          : t('server.health.down', { service })
      } ${t(`server.health.effects.${health.service.id}`)}`,
      action: t('server.health.whatToDo'),
    };
  }
  if (health.level === 'warn')
    return {
      tone: 'warn' as const,
      icon: 'warning' as const,
      title: t('server.health.warn'),
      text:
        health.reason === 'space'
          ? t('server.health.reasons.space', {
              free: formatStorage(status.storage.free ?? 0, lang),
            })
          : health.reason === 'backup'
            ? t('server.health.reasons.backup', {
                when: status.backup.lastAt ? when(status.backup.lastAt, now) : '—',
              })
            : t('server.health.reasons.check', {
                check: t(`diagnostics.checks.${health.check?.id}.title`),
              }),
      action: t('server.health.whatToDo'),
    };
  const b = status.backup;
  return {
    tone: 'ok' as const,
    icon: 'check' as const,
    title: t('server.health.ok'),
    text: [
      t('server.health.checks', {
        ok: checks.filter((c) => c.status === 'ok').length,
        total: checks.length,
      }),
      b.lastAt
        ? t(`server.health.backup.${b.lastStatus ?? 'none'}`, { when: when(b.lastAt, now) })
        : t('server.health.backup.none'),
      open ? t('server.health.problems', { count: open }) : t('server.health.noProblems'),
    ].join(' · '),
    action: open > 0 ? t('server.health.seeProblem', { count: open }) : null,
  };
}

/**
 * The card on top of both views: the verdict in one sentence (green, orange or red), then four
 * facts in equal cells; the last two differ by view.
 */
export function StatusCard({
  status,
  checks,
  advanced = false,
}: {
  status: ServerStatus;
  checks: DiagnosticCheck[];
  advanced?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const lang = i18n.language;
  const health = healthOf(status, checks);
  const v = verdict(t, health, status, checks, when, lang);
  const now = new Date(status.checkedAt).getTime();
  const uptime = status.startedAt
    ? duration(now - new Date(status.startedAt).getTime(), lang, advanced ? 'short' : 'long')
    : '—';
  const fact = (label: string, value: ReactNode) => (
    <div className="server-cell">
      <dt className="server-cell__label">{label}</dt>
      <dd className="server-cell__fact">{value}</dd>
    </div>
  );
  const p = status.presence;
  const v2 = status.transcodes;
  return (
    <section className="settings-block server-status" data-tour="server">
      {/* Read out when the verdict changes, not at every reading as the uptime grows. */}
      <p className="ink-sr-only" aria-live="polite">
        {v.title}
      </p>
      <div className="settings-card">
        <Summary
          tone={v.tone}
          icon={v.icon}
          title={v.title}
          text={v.text}
          action={v.action && <Button onClick={scrollToProblems}>{v.action}</Button>}
        />
        <dl className="server-cells">
          {fact(t('server.advanced.version'), status.version)}
          {fact(t('server.advanced.uptime'), uptime)}
          {advanced ? (
            <>
              {fact(
                t('server.advanced.processes'),
                [...new Set(status.processes.map((x) => t(`server.roles.${x.role}`)))].join(
                  ' · ',
                ) || '—',
              )}
              {fact(
                t('server.advanced.video'),
                status.encoder ? status.encoder.backend.toUpperCase() : '—',
              )}
            </>
          ) : (
            <>
              {fact(
                t('server.simple.connected'),
                <>
                  {t('server.people.people', { count: p.people })}
                  {p.boards.length > 0 && (
                    <small>
                      {' '}
                      {t('server.simple.onBoards', {
                        boards: t('server.people.boards', { count: p.boards.length }),
                      })}
                    </small>
                  )}
                </>,
              )}
              {fact(
                t('server.videos.title'),
                <>
                  {v2.active.length}
                  {v2.waiting > 0 && (
                    <small> · {t('server.simple.waiting', { n: v2.waiting })}</small>
                  )}
                </>,
              )}
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

/** A cell with a name, a verdict as dot, colour and word, a value and a line. */
export function VerdictCell({
  name,
  verdict,
  warn,
  value,
  children,
}: {
  name: string;
  verdict: string | null;
  warn?: boolean;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="server-cell">
      <div className="server-cell__head">
        <span className="server-cell__name">{name}</span>
        {verdict && (
          <span className={warn ? 'server-verdict server-verdict--warn' : 'server-verdict'}>
            {verdict}
          </span>
        )}
      </div>
      <div className="server-value">{value}</div>
      {children}
    </div>
  );
}

/** A thin bar of a share, read out with its words. */
export function ShareBar({
  share,
  label,
  text,
  warn,
}: {
  share: number;
  label: string;
  text: string;
  warn?: boolean;
}) {
  const value = Math.min(100, Math.max(0, share * 100));
  return (
    <span
      className={warn ? 'server-bar server-bar--warn' : 'server-bar'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={text}
    >
      <span className="server-bar__fill" style={{ width: `${value}%` }} />
    </span>
  );
}

/** Three questions: is there room, are the data safe, is it fast. */
function HowItIs({ status }: { status: ServerStatus }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const lang = i18n.language;
  const store = status.storage;
  const space = storageVerdict(store);
  const speed = speedVerdict(status.now.responses.p95);
  const now = new Date(status.checkedAt).getTime();
  const b = status.backup;
  const backupKey = !b.lastStatus ? (b.enabled ? 'none' : 'off') : b.lastStatus;
  const files = store.originals + store.copies + store.previews;
  const mostlyOriginals = files > 0 && store.originals / files >= 0.8;
  const full = space.key === 'almostFull';
  let spaceHint: ReactNode;
  if (store.total === null) {
    spaceHint = [
      t('server.meters.storage.s3Hint'),
      store.growthPerMonth
        ? t('server.meters.storage.growth', { size: formatStorage(store.growthPerMonth, lang) })
        : null,
    ]
      .filter(Boolean)
      .join(' ');
  } else if (full) {
    spaceHint = (
      <>
        {t('server.how.space.left', { free: formatStorage(store.free ?? 0, lang) })} ·{' '}
        <Link to="/settings?section=workspace" replace>
          {t('storageLimits.title')}
        </Link>
      </>
    );
  } else if (mostlyOriginals) {
    spaceHint = diskCompresses(store)
      ? t('server.how.space.beforeCompression', { size: formatStorage(store.originals, lang) })
      : t('server.how.space.mostlyOriginals');
  } else {
    spaceHint = [
      t('server.meters.storage.split', {
        originals: formatStorage(store.originals, lang),
        derived: formatStorage(store.copies + store.previews, lang),
      }),
      diskCompresses(store) ? t('server.meters.storage.compressed') : null,
    ]
      .filter(Boolean)
      .join(' ');
  }
  const of =
    store.total !== null
      ? t('server.meters.of', { total: formatStorage(store.total, lang) })
      : t('server.meters.storage.used');
  return (
    <Card anchor="server.health" title={t('server.how.title')} tour="server-health">
      <div className="server-cells server-cells--3">
        <VerdictCell
          name={t('server.meters.storage.name')}
          verdict={
            store.total === null
              ? t('server.meters.storage.bucket')
              : space.key === 'unknown'
                ? null
                : t(`server.meters.storage.${space.key}`, { count: space.months ?? 0 })
          }
          warn={full}
          value={
            <>
              {formatStorage(store.used, lang)} <small>{of}</small>
            </>
          }
        >
          {store.total !== null && store.total > 0 && (
            <ShareBar
              share={store.used / store.total}
              label={t('server.how.space.bar')}
              text={`${formatStorage(store.used, lang)} ${of}`}
              warn={full}
            />
          )}
          <div className="server-hint">{spaceHint}</div>
        </VerdictCell>
        <VerdictCell
          name={t('server.meters.backup.name')}
          verdict={t(`server.meters.backup.${backupKey}`)}
          warn={backupKey === 'failed' || backupKey === 'none'}
          value={<span className="server-value--text">{b.lastAt ? when(b.lastAt, now) : '—'}</span>}
        >
          <div className="server-hint">
            {[
              b.lastStatus === 'failed' && b.lastSuccessAt
                ? t('server.how.backup.lastSuccess', { when: when(b.lastSuccessAt, now) })
                : b.size !== null
                  ? formatStorage(b.size, lang)
                  : null,
              b.nextAt ? t('server.meters.backup.next', { when: when(b.nextAt, now) }) : null,
            ]
              .filter(Boolean)
              .map((part) => `${part} · `)
              .join('')}
            <Link to="/settings?section=backups" replace>
              {t('backups.title')}
            </Link>
          </div>
        </VerdictCell>
        <VerdictCell
          name={t('server.meters.speed.name')}
          verdict={t(`server.meters.speed.${speed}`)}
          warn={speed === 'verySlow'}
          value={
            status.now.responses.p95 === null ? (
              '—'
            ) : (
              <>
                {number(status.now.responses.p95 / 1000, lang, 2)}{' '}
                <small>{t('server.meters.speed.unit')}</small>
              </>
            )
          }
        >
          <div className="server-hint">{t('server.meters.speed.hint')}</div>
        </VerdictCell>
      </div>
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
      anchor="server.people"
      title={t(advanced ? 'server.advanced.people' : 'server.people.title')}
      action={
        <span className="settings-card__meta">
          {advanced && p.peak !== null
            ? `${counts} · ${t('server.people.peak', { value: p.peak })}`
            : counts}
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
                  {[
                    b.projectName,
                    t('server.people.since', {
                      time: duration(now - new Date(b.since).getTime(), i18n.language),
                    }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="server-avatars">
                {b.people.length > 0 ? (
                  b.people
                    .slice(0, 4)
                    .map((u) => <Avatar key={u.id} name={u.name} image={u.image} size={24} />)
                ) : (
                  <span className="server-count">
                    <span aria-hidden="true">{b.count}</span>
                    <span className="ink-sr-only">
                      {t('server.people.people', { count: b.count })}
                    </span>
                  </span>
                )}
                {b.people.length > 4 && (
                  <span className="server-count">+{b.people.length - 4}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A problem in plain words: what happened, which file, and what it means (#514). */
export function problemText(
  t: (key: string, values?: Record<string, unknown>) => string,
  p: ServerProblem,
) {
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
  'board_save_failed',
  'board_load_failed',
  'config_check',
]);

function Problems({ status, checks, actions }: Props) {
  const { t } = useTranslation();
  const open = sortedProblems(status.problems, healthOf(status, checks));
  return (
    <section id={PROBLEMS_ID} className="server-anchor" data-tour="server-problems">
      <Card
        anchor="server.problems"
        className="server-card-wrap"
        title={t('server.problems.title')}
        action={
          <span className="server-card-actions">
            <span className="settings-card__meta server-hide-phone">
              {t('server.problems.period')}
            </span>
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
                      {p.count > 1 && (
                        <span className="settings-badge">
                          {t('server.problems.times', { count: p.count })}
                        </span>
                      )}
                    </span>
                    <span className="settings-row__help">
                      {[text.where, text.text].filter(Boolean).join(' ')}
                    </span>
                    <button
                      type="button"
                      className="server-link server-problem__more"
                      aria-label={t('server.problems.technicalInNamed', { title: text.title })}
                      onClick={() => peekProblem(p.id)}
                    >
                      {t('server.problems.technicalIn')}
                    </button>
                  </div>
                  {p.kind !== 'config_check' && (
                    <span className="server-problem__actions">
                      {p.retry && (
                        <Button
                          aria-label={t('server.problems.retryNamed', { title: text.title })}
                          onClick={() => void actions.retry(p)}
                        >
                          {t('server.problems.retry')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        aria-label={t('server.problems.seenNamed', { title: text.title })}
                        onClick={() => void actions.seen(p)}
                      >
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
        <Row
          anchor="server.alerts"
          label={t('server.alerts.enabled')}
          help={t('server.alerts.enabledHelp')}
        >
          <Switch
            aria-label={t('server.alerts.enabled')}
            checked={status.alerts.enabled}
            onChange={(e) => void actions.saveAlerts({ enabled: e.target.checked })}
          />
        </Row>
        <Row
          anchor="server.alertsHow"
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

/** The door to the Advanced view, and the details someone non-technical sends on. */
function ForAdmins({ status, checks }: { status: ServerStatus; checks: DiagnosticCheck[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="settings-rows">
        <Row
          anchor="server.admin"
          className="server-admins"
          icon="key"
          label={t('server.admin.title')}
          help={t('server.admin.lead')}
        >
          <Button
            icon="copy"
            onClick={() => void navigator.clipboard?.writeText(technicalSummary(status, checks))}
          >
            {t('server.details.copy')}
          </Button>
          <Button
            onClick={() => void updatePreferences({ serverView: 'advanced' }).catch(() => {})}
          >
            {t('server.admin.open')}
          </Button>
        </Row>
      </div>
    </Card>
  );
}

/** A file name that wraps after `_` and `-` rather than inside a word or its extension. */
function breakable(text: string) {
  return text.split(/(?<=[_-])/).map((part, i, all) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string.
    <Fragment key={i}>
      {part}
      {i < all.length - 1 && <wbr />}
    </Fragment>
  ));
}

export function ProcessTable({ status }: { status: ServerStatus }) {
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
              {t('server.details.signal')}
            </th>
          </tr>
        </thead>
        <tbody>
          {status.processes.map((p) => (
            <Fragment key={`${p.role}@${p.host}`}>
              <tr>
                <th scope="row">
                  <span className={`server-dot server-dot--${p.status}`} aria-hidden="true" />
                  {t(`server.roles.${p.role}`)}
                  <span className="ink-sr-only">
                    {' '}
                    ·{' '}
                    {t(
                      `server.services.status.${p.status === 'ok' ? 'ok' : p.status === 'late' ? 'warning' : 'down'}`,
                    )}
                  </span>
                </th>
                <td
                  className={
                    p.cpu === null ? 'server-table__n server-table__zero' : 'server-table__n'
                  }
                >
                  {p.cpu === null || !status.now.cpu.cores
                    ? '—'
                    : percent(p.cpu / status.now.cpu.cores, lang)}
                </td>
                <td
                  className={
                    p.memory === null ? 'server-table__n server-table__zero' : 'server-table__n'
                  }
                >
                  {p.memory === null ? '—' : formatStorage(p.memory, lang)}
                </td>
                <td className="server-table__n">
                  {new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(
                    Math.min(0, Math.round((new Date(p.lastSeenAt).getTime() - now) / 1000)),
                    'second',
                  )}
                </td>
              </tr>
              {p.children?.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two runs of a tool may share a name and start.
                <tr key={i} className="server-table__child">
                  <th scope="row">
                    <span className="ink-sr-only">
                      {t('server.details.toolOf', { role: t(`server.roles.${p.role}`) })}{' '}
                    </span>
                    {c.tool}
                    {c.label && (
                      <span className="server-table__label">
                        <span className="ink-sr-only"> · </span>
                        {breakable(c.label)}
                      </span>
                    )}
                  </th>
                  <td
                    className={
                      c.cpu === null ? 'server-table__n server-table__zero' : 'server-table__n'
                    }
                  >
                    {c.cpu === null || !status.now.cpu.cores
                      ? '—'
                      : percent(c.cpu / status.now.cpu.cores, lang)}
                  </td>
                  <td
                    className={
                      c.memory === null ? 'server-table__n server-table__zero' : 'server-table__n'
                    }
                  >
                    {c.memory === null ? '—' : formatStorage(c.memory, lang)}
                  </td>
                  <td className="server-table__n">
                    {t('server.details.runningFor', {
                      time: duration(now - new Date(c.startedAt).getTime(), lang, 'short'),
                    })}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          {status.database.version && (
            <tr>
              <th scope="row">
                <span className="server-dot server-dot--ok" aria-hidden="true" />
                {status.database.version}
              </th>
              <td className="server-table__n server-table__zero">—</td>
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
  const cell = (n: number, fail = false) => (
    <td
      className={
        n === 0
          ? 'server-table__n server-table__zero'
          : fail
            ? 'server-table__n server-table__fail'
            : 'server-table__n'
      }
    >
      {n}
    </td>
  );
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
              {cell(q.waiting)}
              {cell(q.active)}
              {cell(q.failed24h, true)}
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
      <StatusCard status={status} checks={checks} />
      <HowItIs status={status} />
      <Problems status={status} checks={checks} actions={actions} />
      <Alerts status={status} actions={actions} />
      <ForAdmins status={status} checks={checks} />
    </>
  );
}
