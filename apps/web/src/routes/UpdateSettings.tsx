import type { InstanceRelease } from '@inkadra/shared';
import { Button, Icon, Select, Switch } from '@inkadra/ui';
import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDateTime } from '../lib/datetime.ts';
import { useSession } from '../lib/session.tsx';
import { checkUpdatesNow, loadUpdates, releaseNews, useUpdates } from '../lib/updates.ts';
import { useInstanceSettings } from './InstanceSettings.tsx';
import { Badge, Card, Row, Summary, Tile } from './settings-ui.tsx';
import './update-settings.css';

const RELEASES = 'https://github.com/inkadra/inkadra/releases';
const GUIDE = 'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/upgrades.md';

const day = (value: string | null, month: 'long' | 'short' = 'long') =>
  value ? formatDateTime(value, { day: 'numeric', month }) : null;

/** Settings → Updates (#515, decision 0080): the running version, a new one, the history. */
export function UpdateSettings() {
  const { t, i18n } = useTranslation();
  const { data, error, checking } = useUpdates();
  const { settings, error: settingsError, save } = useInstanceSettings();
  const { instance } = useSession();
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
  // Edge builds are never compared with releases (decision 0080): no "up to date" for them.
  const warn = data.checkEnabled && (data.failed || data.edge);

  const news = available ? releaseNews(available, i18n.language) : null;
  const date = available ? day(available.publishedAt) : null;
  return (
    <>
      {available && news ? (
        <Summary
          tour="updates"
          tone="accent"
          icon="upload"
          title={t('updates.available', { version: available.version })}
          text={
            <>
              {[
                t('updates.running', { version: data.current }),
                date && t('updates.released', { date }),
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              <Badge tone={available.prerelease ? 'accent' : 'neutral'}>
                {t(available.prerelease ? 'updates.preview' : 'updates.stable')}
              </Badge>
            </>
          }
          action={
            <a
              className="ink-btn ink-btn--primary"
              href={available.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('updates.readAll')}
            </a>
          }
        />
      ) : (
        <Summary
          tour="updates"
          tone={warn ? 'warn' : 'ok'}
          icon={warn ? 'warning' : 'check'}
          title={t(
            !data.checkEnabled
              ? 'updates.offTitle'
              : data.edge
                ? 'updates.edgeTitle'
                : data.failed
                  ? 'updates.failedTitle'
                  : data.checkedAt
                    ? 'updates.upToDate'
                    : 'updates.notChecked',
          )}
          text={[
            t('updates.running', { version: data.current }),
            data.checkEnabled && data.edge ? t('updates.edgeHelp') : null,
            data.checkEnabled && checked && !data.edge
              ? t('updates.checkedAt', { time: checked })
              : null,
            !data.checkEnabled ? t('updates.offHelp') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      )}
      {available && news && <NewVersion release={available} news={news} />}
      <Card
        tour="updates-alerts"
        title={t('updates.alerts')}
        action={
          data.checkEnabled && (
            <Button variant="ghost" disabled={checking} onClick={() => void checkUpdatesNow()}>
              {t(checking ? 'updates.checking' : 'updates.checkNow')}
            </Button>
          )
        }
      >
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
          <Row
            label={t('settingsUi.notifications.releaseNews')}
            help={t('settingsUi.notifications.releaseNewsAdminHelp')}
          >
            <Switch
              aria-label={t('settingsUi.notifications.releaseNews')}
              checked={settings.releaseNews ?? true}
              disabled={!instance?.auth.email}
              onChange={(e) => void save({ releaseNews: e.target.checked }).catch(() => {})}
            />
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
                  {releaseNews(r, i18n.language).highlights[0] ?? t('updates.noSummary')}
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

/** How to update to the new release: its news, then the technical part folded away. */
function NewVersion({
  release,
  news,
}: {
  release: InstanceRelease;
  news: ReturnType<typeof releaseNews>;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t('settingsUi.updates.how')}>
      {news.highlights.length > 0 && (
        <ul className="settings-card__pad updates-news">
          {news.highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {news.beforeUpdating.length > 0 && (
        <details className="settings-fold">
          <summary className="settings-row">
            <Tile icon="warning" tone="warn" />
            <span className="settings-row__text">
              <span className="settings-row__label">
                {t('updates.beforeUpdating', { count: news.beforeUpdating.length })}
              </span>
            </span>
            <Icon name="chevronRight" size={14} className="settings-fold__chevron" />
          </summary>
          <ul className="settings-fold__body updates-news">
            {news.beforeUpdating.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      <details className="settings-fold">
        <summary className="settings-row">
          <Tile icon="todo" />
          <span className="settings-row__text">
            <span className="settings-row__label">{t('updates.how')}</span>
          </span>
          <Icon name="chevronRight" size={14} className="settings-fold__chevron" />
        </summary>
        <div className="settings-fold__body">
          <ol className="updates-how">
            <li>
              <Trans
                i18nKey="updates.howBackup"
                components={{
                  backup: <Link className="updates-link" to="/settings?section=backups" replace />,
                }}
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
          <p className="settings-footnote">
            {t('updates.howRest')}{' '}
            <a className="updates-link" href={GUIDE} target="_blank" rel="noopener noreferrer">
              {t('updates.guide')}
            </a>
          </p>
        </div>
      </details>
    </Card>
  );
}
