import {
  FEEDBACK_RETENTION_OPTIONS,
  type FeedbackReport,
  type FeedbackSettingsInput,
  type FeedbackSettings as Settings,
} from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon, IconButton, Select, Switch } from '@inkadra/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { useIsPhone } from '../lib/phone.ts';
import { AutosaveText, Badge, Card, Row, Tile } from '../routes/settings-ui.tsx';
import { openFeedback, STATUS_CHANGED, useFeedbackStatus } from './state.ts';

const WHEN = { dateStyle: 'medium', timeStyle: 'short' } as const;
const RELOAD_MS = 10000;
const TONE = {
  delivered: 'ok',
  pending: 'warn',
  uncertain: 'warn',
  refused: 'warn',
  inbox: 'neutral',
} as const;

/** The Settings row: opens the form, or says in one line why it cannot. */
export function FeedbackRow() {
  const { t } = useTranslation();
  const status = useFeedbackStatus();
  const on = !!status?.enabled;
  return (
    <Row
      icon="report"
      tone="warn"
      label={t('feedback.title')}
      help={t(on ? 'feedback.rowHelp' : 'feedback.rowOff')}
    >
      <Button disabled={!on} onClick={() => openFeedback()}>
        {t('feedback.open')}
      </Button>
    </Row>
  );
}

/** Text a person wrote, opened only by an administrator. React escapes it. */
function ReportList({
  reports,
  relay = false,
  onRetry,
  onDelete,
}: {
  reports: FeedbackReport[];
  relay?: boolean;
  onRetry?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retried, setRetried] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<FeedbackReport | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const deleted = useRef(false);
  async function confirmDelete() {
    if (!doomed || !onDelete) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(doomed.id);
      deleted.current = true;
      setDoomed(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div ref={list} tabIndex={-1} className="settings-rows feedback-reports">
      {!reports.length && (
        <p className="settings-card__empty settings-muted">{t('feedback.emptyInbox')}</p>
      )}
      {reports.map((r) => (
        <div key={r.id} className="feedback-reports__item">
          <details>
            <summary className="settings-row">
              <Tile icon="report" tone={r.delivery === 'inbox' ? 'accent' : 'warn'} />
              <span className="settings-row__text">
                <span className="settings-row__label feedback-reports__title">
                  {r.reference} · {r.report.title}
                </span>
                <span className="settings-row__help">
                  {r.reporter} · {formatDateTime(r.createdAt, WHEN)}
                </span>
              </span>
              <span className="settings-row__control">
                <Badge tone={TONE[r.delivery]}>
                  {t(
                    r.delivery === 'uncertain' && relay
                      ? 'feedback.relayUncertainBadge'
                      : `feedback.delivery.${r.delivery}`,
                  )}
                </Badge>
              </span>
            </summary>
            <div className="feedback-reports__body">
              {r.failure && <p role="note">{t('feedback.failure', { reason: r.failure })}</p>}
              {onRetry && r.delivery === 'pending' && (
                <p>
                  <Button
                    disabled={!!retrying}
                    onClick={() => {
                      setRetrying(r.id);
                      setRetried(null);
                      void onRetry(r.id).finally(() => {
                        setRetrying(null);
                        setRetried(r.id);
                      });
                    }}
                  >
                    {t('feedback.retryRefused')}
                  </Button>
                </p>
              )}
              {retried === r.id && r.delivery === 'pending' && (
                <p role="status">{t('feedback.retryWaiting')}</p>
              )}
              {r.report.description && <p>{r.report.description}</p>}
              {r.issueUrl && (
                <p>
                  <a href={r.issueUrl} rel="noreferrer" target="_blank">
                    {t('feedback.openIssue')}
                  </a>
                </p>
              )}
              {r.report.attachments.map((a) => (
                <p key={a.id}>
                  <a href={`/api/v1/feedback/attachments/${a.id}`} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                </p>
              ))}
              {Object.entries(r.report.diagnostics).map(([part, value]) => (
                <pre key={part}>{value}</pre>
              ))}
            </div>
          </details>
          {onDelete && (
            <IconButton
              icon="trash"
              label={t('feedback.delete')}
              aria-label={`${t('feedback.delete')}: ${r.reference} · ${r.report.title}`}
              className="feedback-reports__delete"
              onClick={() => setDoomed(r)}
            />
          )}
        </div>
      ))}
      <Dialog
        open={!!doomed}
        title={t('feedback.deleteTitle')}
        onCancel={(e) => {
          if (deleting) e.preventDefault();
        }}
        onClose={() => {
          setDoomed(null);
          setDeleteFailed(false);
          // The button that opened the dialog went with its row: focus stays in the list.
          if (deleted.current) list.current?.focus({ preventScroll: true });
          deleted.current = false;
        }}
      >
        <span className="settings-row__label feedback-reports__title">
          {doomed?.reference} · {doomed?.report.title}
        </span>
        <p>{t('feedback.deleteBody')}</p>
        {deleteFailed && (
          <p className="settings__status settings__status--error" role="alert">
            {t('feedback.deleteFailed')}
          </p>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={deleting} onClick={() => setDoomed(null)}>
            {t('project.cancel')}
          </Button>
          <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
            {t('feedback.deleteConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** Settings › Reports (decision 0124): where reports go, and those received. Administrators only. */
export function FeedbackSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [error, setError] = useState('');
  const phone = useIsPhone();
  const refresh = useCallback(async () => {
    setSettings(await api.get<Settings>('/feedback/settings'));
    setReports((await api.get<{ items: FeedbackReport[] }>('/feedback/reports')).items);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setError(t('feedback.settingsFailed')));
  }, [refresh, t]);
  // Delivery goes on after the answer, on this server: without this the list stays on what it read.
  // Reports only: a choice still waiting on this page for its repository must survive.
  const unsettled = reports.some((r) => r.delivery === 'pending' || r.delivery === 'uncertain');
  const reload = useCallback(async () => {
    setReports((await api.get<{ items: FeedbackReport[] }>('/feedback/reports')).items);
  }, []);
  useEffect(() => {
    if (!unsettled) return;
    const timer = setInterval(() => void reload().catch(() => {}), RELOAD_MS);
    return () => clearInterval(timer);
  }, [unsettled, reload]);

  async function retry(id: string) {
    setError('');
    try {
      await api.post(`/feedback/reports/${id}/retry`, {});
      await reload();
    } catch {
      setError(t('feedback.retryFailed'));
    }
  }

  async function remove(id: string) {
    // Another administrator got there first: that is what was asked for.
    await api.delete(`/feedback/reports/${id}`).catch((err) => {
      if (!(err instanceof RequestError && err.status === 404)) throw err;
    });
    setReports((list) => list.filter((r) => r.id !== id));
  }

  async function save(next: FeedbackSettingsInput) {
    setSettings((old) => old && { ...old, ...next });
    setError('');
    // GitHub needs a repository: the choice waits on this page until one is named.
    if (next.destination === 'github' && !next.repository) return;
    try {
      setSettings(await api.put<Settings>('/feedback/settings', next));
      window.dispatchEvent(new Event(STATUS_CHANGED));
    } catch {
      setError(t('feedback.saveFailed'));
    }
  }
  if (!settings)
    return error ? (
      <Card title={t('feedback.settingsTitle')}>
        <p role="alert" className="settings-card__empty">
          {error}
        </p>
      </Card>
    ) : null;

  const input: FeedbackSettingsInput = {
    destination: settings.destination,
    repository: settings.repository,
    guests: settings.guests,
    retentionDays: settings.retentionDays,
  };
  const latest = reports.find((r) => r.delivery === 'delivered');
  const waiting = reports.filter((r) => r.delivery === 'pending').length;
  const uncertain = reports.filter((r) => r.delivery === 'uncertain').length;
  const refused = reports.filter((r) => r.delivery === 'refused');
  const github = settings.destination === 'github';
  const relay = settings.destination === 'relay';
  const relayWaiting = reports.filter((r) => r.delivery === 'pending' && r.failure);
  return (
    <>
      <Card title={t('feedback.destination')}>
        <div className="feedback-settings">
          {error && (
            <div className="feedback-banner feedback-banner--danger" role="alert">
              <Icon name="warning" size={14} />
              <div>{error}</div>
            </div>
          )}
          {(github || relay) && refused.length > 0 && (
            <div className="feedback-banner feedback-banner--danger" role="alert">
              <Icon name="warning" size={14} />
              <div>
                <p>
                  {t(relay ? 'feedback.relayRefusedBanner' : 'feedback.refusedBanner', {
                    count: refused.length,
                    reason: refused[0]?.failure ?? '',
                  })}
                </p>
                <Button onClick={() => void save(input).then(refresh)}>
                  {t('feedback.retryRefused')}
                </Button>
              </div>
            </div>
          )}
          {relay && uncertain > 0 && (
            <div className="feedback-banner feedback-banner--warn" role="status">
              <Icon name="warning" size={14} />
              <div>
                <p>{t('feedback.relayUncertainBanner', { count: uncertain })}</p>
                <Button onClick={() => void save(input).then(refresh)}>
                  {t('feedback.retryRefused')}
                </Button>
              </div>
            </div>
          )}
          {relay && relayWaiting.length > 0 && (
            <div className="feedback-banner feedback-banner--warn" role="status">
              <Icon name="warning" size={14} />
              <div>{t('feedback.relayWaitingBanner', { count: relayWaiting.length })}</div>
            </div>
          )}
          {github && !settings.tokenConfigured && (
            <div className="feedback-banner feedback-banner--warn" role="status">
              <Icon name="warning" size={14} />
              <div>{t('feedback.tokenMissingBanner')}</div>
            </div>
          )}
          <Row
            label={t('feedback.destination')}
            help={t(relay ? 'feedback.privacyRelay' : 'settingsUi.reports.copyHere')}
          >
            <Select
              aria-label={t('feedback.destination')}
              value={settings.destination}
              onChange={(destination) =>
                void save({ ...input, destination: destination as Settings['destination'] })
              }
              options={(['relay', 'github', 'inbox', 'off'] as const).map((value) => ({
                value,
                label: t(`feedback.destinations.${value}`),
              }))}
            />
          </Row>
          <div className="settings-rows">
            {github && (
              <Row
                label={t('feedback.repository')}
                help={t('feedback.repositoryHelp')}
                htmlFor="feedback-repository"
              >
                <AutosaveText
                  id="feedback-repository"
                  label={t('feedback.repository')}
                  value={settings.repository ?? ''}
                  maxLength={140}
                  save={(repository) => save({ ...input, repository })}
                />
              </Row>
            )}
            {github && (
              <Row
                label={t('feedback.token')}
                help={t(
                  settings.tokenConfigured ? 'feedback.tokenHelp' : 'feedback.tokenMissingHelp',
                )}
              >
                <Badge tone={settings.tokenConfigured ? 'ok' : 'warn'}>
                  {t(
                    settings.tokenConfigured ? 'feedback.tokenConfigured' : 'feedback.tokenMissing',
                  )}
                </Badge>
              </Row>
            )}
            {(github || relay) && (
              <Row
                label={t('feedback.lastDelivery')}
                help={[
                  latest ? formatDateTime(latest.createdAt, WHEN) : t('feedback.noDelivery'),
                  t('feedback.waiting', { count: waiting }),
                  ...(uncertain
                    ? [
                        t(relay ? 'feedback.relayUncertain' : 'feedback.uncertain', {
                          count: uncertain,
                        }),
                      ]
                    : []),
                ].join(' · ')}
              >
                {latest && !uncertain && <Badge tone="ok">{t('feedback.delivered')}</Badge>}
              </Row>
            )}
          </div>
        </div>
      </Card>
      <Card title={t('settingsUi.reports.rules')}>
        <Row label={t('feedback.allowGuests')} help={t('feedback.allowGuestsHelp')}>
          <Switch
            aria-label={t('feedback.allowGuests')}
            checked={settings.guests}
            onChange={(e) => void save({ ...input, guests: e.target.checked })}
          />
        </Row>
        <Row
          label={t('feedback.retention')}
          help={t(relay ? 'feedback.relayRetentionHelp' : 'feedback.retentionHelp')}
        >
          <Select
            aria-label={t('feedback.retention')}
            value={String(settings.retentionDays)}
            onChange={(value) =>
              void save({
                ...input,
                retentionDays: Number(value) as FeedbackSettingsInput['retentionDays'],
              })
            }
            options={FEEDBACK_RETENTION_OPTIONS.map((days) => ({
              value: String(days),
              label: t(`feedback.retentionDays.${days}`),
            }))}
          />
        </Row>
      </Card>
      <Card
        title={t('feedback.received')}
        body={t('feedback.receivedLead')}
        action={
          !phone && (
            <Button
              variant="ghost"
              onClick={() => void refresh().catch(() => setError(t('feedback.settingsFailed')))}
            >
              {t('feedback.refresh')}
            </Button>
          )
        }
      >
        <ReportList
          reports={reports}
          relay={relay}
          // GitHub without a token has nothing to send with: the banner above says so.
          onRetry={relay || (github && settings.tokenConfigured) ? retry : undefined}
          onDelete={remove}
        />
      </Card>
    </>
  );
}

/** Opened from the notification of a new report. */
export function FeedbackInbox({ loading }: { loading?: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedbackReport[] | null>(null);
  const [failed, fail] = useState(false);
  useEffect(() => {
    void api
      .get<{ items: FeedbackReport[] }>('/feedback/reports')
      .then((r) => setItems(r.items))
      .catch(() => fail(true));
  }, []);
  return (
    <Card title={t('feedback.received')}>
      {failed && (
        <p role="alert" className="settings-card__empty">
          {t('feedback.settingsFailed')}
        </p>
      )}
      {!items &&
        !failed &&
        (loading ?? (
          <p role="status" className="settings-card__empty settings-muted">
            {t('admin.loading')}
          </p>
        ))}
      {items && <ReportList reports={items} />}
    </Card>
  );
}
