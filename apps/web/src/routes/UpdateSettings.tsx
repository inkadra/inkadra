import type { InstanceRelease } from '@inkadra/shared';
import { Button, Icon, Select, Switch } from '@inkadra/ui';
import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDateTime } from '../lib/datetime.ts';
import { checkUpdatesNow, loadUpdates, useUpdates } from '../lib/updates.ts';
import { useInstanceSettings } from './InstanceSettings.tsx';
import { Badge, Card, Row } from './settings-ui.tsx';
import './update-settings.css';

const RELEASES = 'https://github.com/inkadra/inkadra/releases';
const GUIDE = 'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/upgrades.md';

const day = (value: string | null, month: 'long' | 'short' = 'long') =>
  value ? formatDateTime(value, { day: 'numeric', month }) : null;

/** Settings → Updates (#515, decision 0079): the running version, a new one, the history. */
export function UpdateSettings() {
  const { t } = useTranslation();
  const { data, error, checking } = useUpdates();
  const { settings, error: settingsError, save } = useInstanceSettings();
  const channelId = useId();
  if ((error && !data) || settingsError)
    return (
      <p role="alert" className="settings-footnote">
        {t('updates.loadError')}
      </p>
    );
  if (!data || !settings) return <p role="status">{t('admin.loading')}</p>;

  const change = (patch: { updateCheck?: boolean; updateChannel?: 'stable' | 'preview' }) =>
    void save(patch)
      .then(loadUpdates)
      .catch(() => {});
  const checked = data.checkedAt
    ? formatDateTime(data.checkedAt, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const { available } = data;

  return (
    <>
      <Card
        tour="updates"
        title={t(available ? 'updates.newTitle' : 'updates.versionTitle')}
        action={
          data.checkEnabled && (
            <Button disabled={checking} onClick={() => void checkUpdatesNow()}>
              {t(checking ? 'updates.checking' : 'updates.checkNow')}
            </Button>
          )
        }
      >
        {available ? (
          <NewVersion release={available} current={data.current} />
        ) : (
          <div className="settings-rows">
            <Row
              leading={
                <span
                  className={`updates-state updates-state--${data.failed ? 'warn' : 'ok'}`}
                  aria-hidden="true"
                >
                  <Icon name={data.failed ? 'warning' : 'check'} size={14} />
                </span>
              }
              label={t(
                !data.checkEnabled
                  ? 'updates.offTitle'
                  : data.failed
                    ? 'updates.failedTitle'
                    : data.checkedAt
                      ? 'updates.upToDate'
                      : 'updates.notChecked',
              )}
              help={[
                t('updates.running', { version: data.current }),
                data.checkEnabled && checked ? t('updates.checkedAt', { time: checked }) : null,
                !data.checkEnabled ? t('updates.offHelp') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          </div>
        )}
      </Card>
      <Card tour="updates-alerts" title={t('updates.alerts')}>
        <div className="settings-rows">
          <Row label={t('updates.notify')} help={t('updates.notifyHelp')}>
            <Switch
              aria-label={t('updates.notify')}
              checked={settings.updateCheck ?? true}
              onChange={(e) => change({ updateCheck: e.target.checked })}
            />
          </Row>
          <Row label={t('updates.channel')} help={t('updates.channelHelp')} htmlFor={channelId}>
            <Select
              id={channelId}
              value={settings.updateChannel ?? 'stable'}
              disabled={!(settings.updateCheck ?? true)}
              onChange={(value) => change({ updateChannel: value as 'stable' | 'preview' })}
            >
              <option value="stable">{t('updates.channels.stable')}</option>
              <option value="preview">{t('updates.channels.preview')}</option>
            </Select>
          </Row>
        </div>
      </Card>
      {data.earlier.length > 0 && (
        <Card
          tour="updates-history"
          title={t('updates.earlier')}
          action={
            <a className="updates-link" href={RELEASES} target="_blank" rel="noopener noreferrer">
              {t('updates.allOnGitHub')}
            </a>
          }
        >
          <ul className="settings-list updates-history">
            {data.earlier.map((r) => (
              <li key={r.version}>
                <a
                  className="updates-history__version"
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {r.version}
                </a>
                <span className="updates-history__summary">
                  {r.highlights[0] ?? t('updates.noSummary')}
                </span>
                {r.version === data.current && <Badge tone="ok">{t('updates.inUse')}</Badge>}
                {r.publishedAt && (
                  <time className="updates-history__date" dateTime={r.publishedAt}>
                    {day(r.publishedAt, 'short')}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** The release to update to: its news in plain words, the technical part folded away. */
function NewVersion({ release, current }: { release: InstanceRelease; current: string }) {
  const { t } = useTranslation();
  const date = day(release.publishedAt);
  return (
    <div className="updates-new">
      <div className="updates-new__head">
        <span className="updates-new__icon" aria-hidden="true">
          <Icon name="upload" size={16} />
        </span>
        <div className="updates-new__text">
          <h4 className="updates-new__title">
            {t('updates.available', { version: release.version })}
          </h4>
          <p className="settings-row__help">
            {[t('updates.running', { version: current }), date && t('updates.released', { date })]
              .filter(Boolean)
              .join(' · ')}{' '}
            <Badge tone={release.prerelease ? 'accent' : 'neutral'}>
              {t(release.prerelease ? 'updates.preview' : 'updates.stable')}
            </Badge>
          </p>
        </div>
      </div>
      {release.highlights.length > 0 && (
        <ul className="updates-news">
          {release.highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div>
        <a
          className="ink-btn ink-btn--primary"
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('updates.readAll')}
        </a>
      </div>
      <div className="settings-rows updates-steps">
        {release.beforeUpdating.length > 0 && (
          <details>
            <summary className="settings-row">
              <span className="settings-row__text">
                <span className="settings-row__label updates-steps__warn">
                  {t('updates.beforeUpdating', { count: release.beforeUpdating.length })}
                </span>
              </span>
              <Icon name="chevronRight" size={14} />
            </summary>
            <ul className="updates-news updates-steps__body">
              {release.beforeUpdating.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}
        <details>
          <summary className="settings-row">
            <span className="settings-row__text">
              <span className="settings-row__label">{t('updates.how')}</span>
            </span>
            <Icon name="chevronRight" size={14} />
          </summary>
          <ol className="updates-how updates-steps__body">
            <li>
              <Trans
                i18nKey="updates.howBackup"
                components={{ backup: <Link className="updates-link" to="/settings?section=backups" replace /> }}
              />
            </li>
            <li>
              <Trans i18nKey="updates.howTag" components={{ file: <code /> }} />
              <pre className="updates-code">
                <code>INKADRA_TAG={release.version}</code>
              </pre>
            </li>
            <li>
              {t('updates.howRestart')}
              <pre className="updates-code">
                <code>docker compose pull && docker compose up -d</code>
              </pre>
            </li>
          </ol>
          <p className="settings-footnote updates-steps__foot">
            {t('updates.howRest')}{' '}
            <a className="updates-link" href={GUIDE} target="_blank" rel="noopener noreferrer">
              {t('updates.guide')}
            </a>
          </p>
        </details>
      </div>
    </div>
  );
}
