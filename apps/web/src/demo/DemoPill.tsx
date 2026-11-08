import type { DemoInfo, MyStorage } from '@inkadra/shared';
import { Button, Dialog, DialogActions, Icon, IconButton } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { useSession } from '../lib/session.tsx';
import { useProjects } from '../routes/AppLayout.tsx';
import { useMenu } from '../routes/ProjectAppearance.tsx';
import { ExportProjectDialog } from '../routes/ProjectTransfer.tsx';
import { formatStorage } from '../routes/StorageCharts.tsx';
import { SpaceMeter, spaceTone } from '../routes/StorageSpace.tsx';
import {
  forgetSandbox,
  INSTALL_URL,
  markWarned,
  RULES_URL,
  timeLeft,
  useDemoSandbox,
  useNow,
  WARN_MS,
  warnedFor,
} from './demo.ts';
import './demo.css';

/** The space the sandbox uses, read again now and then and after uploads. */
function useSpace() {
  const [space, setSpace] = useState<MyStorage | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<MyStorage>('/me/storage')
        .then((s) => alive && setSpace(s))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return space;
}

/**
 * The demo in the header (decision 0084): time left and space used, a pill on a wide screen
 * and a row above the title on a phone. Five minutes before the end it turns orange, offers
 * "Download the project" and warns once; at the end the sandbox goes and the page with it.
 */
export function DemoBar({ demo }: { demo: DemoInfo }) {
  const sandbox = useDemoSandbox(true);
  const space = useSpace();
  const { refresh } = useSession();
  const { projects } = useProjects();
  const { t, i18n } = useTranslation();
  const ends = sandbox ? Date.parse(sandbox.expiresAt) : null;
  const now = useNow(ends);
  const [exporting, setExporting] = useState(false);
  const [warning, setWarning] = useState(false);
  const left = ends === null ? Infinity : ends - now;
  const warn = left <= WARN_MS;

  useEffect(() => {
    if (!sandbox || !warn || left <= 0 || warnedFor(sandbox)) return;
    markWarned(sandbox);
    setWarning(true);
  }, [sandbox, warn, left]);
  useEffect(() => {
    if (left > 0) return;
    // Time is up: the sandbox goes now if the server has not taken it yet, then the end page.
    void api
      .delete('/demo/sandbox')
      .catch(() => {})
      .then(() => refresh());
  }, [left, refresh]);

  const restart = async () => {
    await api.delete('/demo/sandbox').catch(() => {});
    forgetSandbox();
    await refresh();
  };
  const menu = useMenu(t('demo.more'), [
    { label: t('demo.restart'), action: () => void restart(), danger: true },
    { label: t('demo.rules'), action: () => window.open(RULES_URL, '_blank', 'noopener') },
  ]);

  const project = projects?.find((p) => p.id === sandbox?.projectId) ?? null;
  const used = space ? space.originalBytes + space.derivedBytes : 0;
  const limit = space?.limit ?? demo.storageBytes;
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const remaining = timeLeft(left);
  const time = t(`demo.left.${remaining.unit}`, { count: remaining.value });
  const spaceText = t('demo.space', { used: size(used), limit: size(limit) });
  const meter = (
    <SpaceMeter
      small
      originals={space?.originalBytes ?? 0}
      derived={space?.derivedBytes ?? 0}
      limit={limit}
      tone={spaceTone(used, limit, 80)}
      label={spaceText}
    />
  );
  const download = (label: string) => (
    <Button icon="download" disabled={!project} onClick={() => setExporting(true)}>
      {label}
    </Button>
  );
  const install = (label: string) => (
    <a className="ink-btn ink-btn--primary" href={INSTALL_URL} target="_blank" rel="noopener">
      {label}
    </a>
  );
  if (!sandbox) return null;

  // Both are always there: CSS shows the row on a phone and the pill elsewhere.
  return (
    <>
      <div className={`demo-row${warn ? ' demo-row--warn' : ''}`}>
        <Icon name="clock" size={14} />
        <span className="demo-row__time">{time}</span>
        {meter}
        <span className="demo-row__space">{spaceText}</span>
        {warn ? download(t('demo.downloadShort')) : install(t('demo.installShort'))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a header pill, not a form: a fieldset would be wrong */}
      <div
        className={`ink-header__group demo-pill${warn ? ' demo-pill--warn' : ''}`}
        role="group"
        aria-label={t('demo.pillLabel', { time, space: spaceText })}
        data-tour="demo-pill"
      >
        <span className="demo-pill__label demo-pill__wide">{t('demo.label')}</span>
        <Icon name="clock" size={14} />
        <span className="demo-pill__time">
          {warn ? (
            <>
              <span className="demo-pill__wide">{t('demo.goesIn', { time })}</span>
              <span className="demo-pill__narrow">{time}</span>
            </>
          ) : (
            time
          )}
        </span>
        <span className="demo-pill__sep" aria-hidden="true" />
        <span className="demo-pill__meter">{meter}</span>
        <span className="demo-pill__space demo-pill__wide">{spaceText}</span>
        {warn && (
          // Narrow screens keep its icon; the name stays for assistive technology.
          <Button
            icon="download"
            className="demo-pill__download"
            aria-label={t('demo.download')}
            disabled={!project}
            onClick={() => setExporting(true)}
          >
            <span className="demo-pill__wide">{t('demo.download')}</span>
          </Button>
        )}
        {install(t('demo.install'))}
        <IconButton
          icon="more"
          label={t('demo.more')}
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          onClick={(e) => menu.open(e.currentTarget, e.currentTarget)}
        />
      </div>
      {menu.layer}
      {createPortal(
        <>
          <Dialog open={warning} title={t('demo.warnTitle')} onClose={() => setWarning(false)}>
            <p className="settings-muted">
              {t('demo.warnText', {
                time: formatDateTime(ends ?? now, { hour: '2-digit', minute: '2-digit' }),
              })}
            </p>
            <DialogActions>
              <Button variant="ghost" onClick={() => setWarning(false)}>
                {t('demo.continue')}
              </Button>
              <Button
                variant="primary"
                icon="download"
                disabled={!project}
                onClick={() => {
                  setWarning(false);
                  setExporting(true);
                }}
              >
                {t('demo.downloadArchive')}
              </Button>
            </DialogActions>
          </Dialog>
          {exporting && project && (
            <ExportProjectDialog project={project} once onClose={() => setExporting(false)} />
          )}
        </>,
        // The header lets clicks through to the board under it: its dialogs live outside.
        document.body,
      )}
    </>
  );
}
