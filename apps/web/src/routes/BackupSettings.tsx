import {
  BACKUP_RETENTION_MAX,
  type InstanceBackup,
  type InstanceBackups,
  type BackupSettings as Settings,
} from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { formatStorage } from './StorageCharts.tsx';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row } from './settings-ui.tsx';
import './backup-settings.css';

const POLL_MS = 2000;
const RETENTION_CHOICES = [3, 7, 14, 30, 60, BACKUP_RETENTION_MAX];

/** Backups of the instance (decision 0037): schedule, retention, back up now, history. */
export function BackupSettings() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<InstanceBackups | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const timeId = useId();
  const retentionId = useId();

  const load = useCallback(async () => {
    try {
      setData(await api.get<InstanceBackups>('/instance/backups'));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const running = data?.items.some((b) => b.status === 'running') ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const save = async (patch: Partial<Settings>) => {
    if (!data) return;
    const previous = data;
    setData({ ...data, settings: { ...data.settings, ...patch } });
    try {
      await trackSave(api.patch<Settings>('/instance/backups/settings', patch));
      await load();
    } catch {
      setData(previous);
    }
  };
  const backUpNow = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await api.post<InstanceBackup>('/instance/backups', {});
      await load();
    } catch (err) {
      setStartError(
        t(
          err instanceof RequestError && err.status === 409 ? 'backups.busy' : 'backups.startError',
        ),
      );
    } finally {
      setStarting(false);
    }
  };

  if (error && !data)
    return (
      <p role="alert" className="settings-footnote">
        {t('backups.loadError')}
      </p>
    );
  if (!data) return <p role="status">{t('admin.loading')}</p>;

  const { settings } = data;
  const time = (value: string) =>
    new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const size = (bytes: number | null) =>
    bytes === null ? null : formatStorage(bytes, i18n.language);
  const last = data.items.find((b) => b.status !== 'running') ?? null;
  const retentionChoices = RETENTION_CHOICES.includes(settings.retention)
    ? RETENTION_CHOICES
    : [...RETENTION_CHOICES, settings.retention].sort((a, b) => a - b);

  return (
    <>
      <Card
        title={t('backups.title')}
        body={t('backups.cardLead')}
        action={
          <Button disabled={starting || running} onClick={() => void backUpNow()}>
            {t(running ? 'backups.running' : 'backups.now')}
          </Button>
        }
      >
        <div className="settings-rows">
          <Row
            label={t('backups.last')}
            help={
              last
                ? [
                    time(last.startedAt),
                    size(last.size),
                    last.files
                      ? t('backups.filesListed', {
                          count: last.files.count,
                          size: size(last.files.bytes),
                        })
                      : null,
                    last.status === 'failed' ? failureText(t, last.failure) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('backups.none')
            }
          >
            {last && <StatusBadge backup={last} />}
          </Row>
          <Row
            label={t('backups.nightly')}
            help={
              settings.enabled && data.nextRunAt
                ? t('backups.next', { time: time(data.nextRunAt) })
                : t('backups.nightlyOff')
            }
          >
            <input
              type="checkbox"
              aria-label={t('backups.nightly')}
              checked={settings.enabled}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
          </Row>
          <Row
            label={t('backups.time')}
            help={t('backups.timeZone', { zone: data.timeZone })}
            htmlFor={timeId}
          >
            <input
              id={timeId}
              className="ink-input backup-settings__time"
              type="time"
              step={60}
              value={settings.time}
              disabled={!settings.enabled}
              onChange={(e) => {
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value))
                  void save({ time: e.target.value });
              }}
            />
          </Row>
          <Row label={t('backups.keep')} help={t('backups.keepHelp')} htmlFor={retentionId}>
            <select
              id={retentionId}
              className="ink-input"
              value={settings.retention}
              onChange={(e) => void save({ retention: Number(e.target.value) })}
            >
              {retentionChoices.map((n) => (
                <option key={n} value={n}>
                  {t('backups.keepCount', { count: n })}
                </option>
              ))}
            </select>
          </Row>
        </div>
        {startError && (
          <p role="alert" className="backup-settings__error">
            {startError}
          </p>
        )}
      </Card>

      <Card title={t('backups.history')}>
        {data.items.length === 0 ? (
          <p className="backup-settings__empty">{t('backups.none')}</p>
        ) : (
          <ul className="backup-list">
            {data.items.map((b) => (
              <li key={b.id} className="backup-list__item">
                <div className="backup-list__text">
                  <span className="backup-list__when">{time(b.startedAt)}</span>
                  <span className="backup-list__meta">
                    {[
                      t(`backups.trigger.${b.trigger}`),
                      size(b.size),
                      b.copiedToBucket ? t('backups.inBucket') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {b.status === 'failed' && (
                    <span className="backup-list__failure">{failureText(t, b.failure)}</span>
                  )}
                  {data.bucket && b.status === 'ready' && b.fileName && !b.copiedToBucket && (
                    <span className="backup-list__failure">{t('backups.notInBucket')}</span>
                  )}
                  {b.fileName && <code className="backup-list__file">{b.fileName}</code>}
                </div>
                <StatusBadge backup={b} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="settings-footnote">
        {t(data.bucket ? 'backups.whereBucket' : 'backups.where')}{' '}
        <code className="settings-env">node /app/dist/main.js backup restore &lt;file&gt;</code>
      </p>
    </>
  );
}

const FAILURES = ['interrupted', 'stalled', 'inconsistent', 'no_space', 'permission', 'internal'];

/** Why a backup failed, in words; reasons this version does not know read as `internal`. */
function failureText(t: (key: string) => string, failure: string | null) {
  return t(`backups.failure.${failure && FAILURES.includes(failure) ? failure : 'internal'}`);
}

function StatusBadge({ backup }: { backup: InstanceBackup }) {
  const { t } = useTranslation();
  if (backup.status === 'running') return <Badge>{t('backups.status.running')}</Badge>;
  if (backup.status === 'failed') return <Badge tone="warn">{t('backups.status.failed')}</Badge>;
  // Retention removed the archive: done, nothing left to act on.
  if (!backup.fileName) return <Badge>{t('backups.status.removed')}</Badge>;
  return <Badge tone="ok">{t('backups.status.ready')}</Badge>;
}
