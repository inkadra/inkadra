import type { CalendarFeed } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toast } from '../board/chrome.tsx';
import { api, RequestError } from '../lib/api.ts';
import { Card, Row, useIsPhone } from '../routes/settings-ui.tsx';

const failure = (err: unknown) =>
  err instanceof RequestError && err.status === 409 ? 'rotated' : 'failed';

export function CalendarSettings() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // 409: the installation secret changed, so the stored link no longer matches.
  const [error, setError] = useState<'failed' | 'rotated' | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<CalendarFeed>('/me/calendar-feed')
      .then((data) => {
        if (alive) setFeed(data);
      })
      .catch((err) => {
        if (alive) setError(failure(err));
      });
    return () => {
      alive = false;
    };
  }, []);
  const closeToast = useCallback(() => setCopied(false), []);
  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      setFeed(await api.post<CalendarFeed>('/me/calendar-feed', {}));
      setConfirm(false);
      setCopied(false);
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!feed?.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setError(null);
    } catch {
      setError('failed');
    }
  }
  const input = (
    <input
      className="ink-input"
      aria-label={t('calendar.link')}
      readOnly
      data-feedback-secret
      value={feed?.url ?? ''}
    />
  );
  const copyButton = (
    <Button
      variant={phone ? 'primary' : 'secondary'}
      block={phone}
      icon="copy"
      disabled={!feed?.url || busy}
      onClick={() => void copy()}
    >
      {t(phone ? 'calendar.copyLink' : 'calendar.copy')}
    </Button>
  );
  return (
    <Card title={t('calendar.title')}>
      {error && (
        <p role="alert" className="settings-card__pad">
          {t(error === 'rotated' ? 'calendar.rotated' : 'calendar.error')}
        </p>
      )}
      {feed?.enabled === false ? (
        <Row icon="calendar" label={t('calendar.link')} help={t('calendar.disabled')} />
      ) : (
        <div className="settings-rows">
          {phone ? (
            <>
              <p className="settings-card__pad calendar-intro">{t('calendar.helpPhone')}</p>
              <div className="settings-card__pad calendar-link">
                {input}
                {copyButton}
                {feed?.url && (
                  <a
                    className="ink-btn ink-btn--secondary ink-btn--block"
                    href={feed.url.replace(/^https?:/, 'webcal:')}
                  >
                    {t('calendar.open')}
                  </a>
                )}
              </div>
            </>
          ) : (
            <Row
              className="calendar-link"
              icon="calendar"
              tone="ok"
              label={t('calendar.link')}
              help={t('calendar.help')}
            >
              {input}
              {copyButton}
            </Row>
          )}
          <Row
            icon="scene"
            label={t('calendar.shooting')}
            help={t(phone ? 'calendar.shootingHelpPhone' : 'calendar.shootingHelp')}
          />
          <Row
            icon="todo"
            label={t(phone ? 'calendar.tasksPhone' : 'calendar.tasks')}
            help={t(phone ? 'calendar.tasksHelpPhone' : 'calendar.tasksHelp')}
          />
          <p className="settings-card__pad calendar-note">
            <Icon name="lock" size={14} />
            {t(phone ? 'calendar.privacyPhone' : 'calendar.privacy')}
          </p>
          {phone ? (
            <div className="settings-card__pad">
              <Button
                block
                variant="danger"
                disabled={busy || (!feed && !error)}
                onClick={() => setConfirm(true)}
              >
                {t('calendar.regenerateActionPhone')}
              </Button>
            </div>
          ) : (
            <Row label={t('calendar.regenerate')} help={t('calendar.revokeHelp')}>
              <Button
                variant="danger"
                disabled={busy || (!feed && !error)}
                onClick={() => setConfirm(true)}
              >
                {t('calendar.regenerateAction')}
              </Button>
            </Row>
          )}
        </div>
      )}
      {copied && <Toast text={t('calendar.copied')} ok onClose={closeToast} />}
      <Dialog
        open={confirm}
        title={t('calendar.confirmTitle')}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
      >
        <p>{t('calendar.confirmBody')}</p>
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
            {t('project.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void regenerate()}>
            {t('calendar.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
