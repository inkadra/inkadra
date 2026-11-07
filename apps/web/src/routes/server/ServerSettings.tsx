import type {
  DiagnosticCheck,
  ServerAlerts,
  ServerProblem,
  ServerRange,
  ServerStatus,
} from '@inkadra/shared';
import { Segmented } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openFeedback } from '../../feedback/state.ts';
import { api } from '../../lib/api.ts';
import { updatePreferences, usePreferences } from '../../lib/preferences.ts';
import { useSession } from '../../lib/session.tsx';
import { probeWebSocket } from '../Diagnostics.tsx';
import { trackSave } from '../settings-save.ts';
import { AdvancedView } from './AdvancedView.tsx';
import { type ServerActions, technicalSummary } from './common.ts';
import { SimpleView } from './SimpleView.tsx';
import './server.css';

/** The samples come every 10 s: the page asks as often while it is visible. */
const POLL_MS = 10_000;

/** Status of the instance, read again every 10 s while the page is on screen. */
function useServerStatus(range: ServerRange) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      setStatus(await api.get<ServerStatus>(`/instance/server?range=${range}`));
      setError(false);
    } catch {
      setError(true);
    }
  }, [range]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  return { status, setStatus, error, load };
}

/** The two checks only the browser can make, as on the Diagnostics page. */
function useBrowserChecks(): DiagnosticCheck[] {
  const { instance } = useSession();
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  useEffect(() => {
    if (!instance) return;
    let alive = true;
    const publicOrigin = new URL(instance.publicUrl).origin;
    void probeWebSocket(instance.collabPath).then((socket) => {
      if (!alive) return;
      setChecks([
        {
          // Only the ids of the Diagnostics catalogue: the page translates them the same way.
          id: 'browser_origin' as DiagnosticCheck['id'],
          status: window.location.origin === publicOrigin ? 'ok' : 'error',
          expected: publicOrigin,
          actual: window.location.origin,
        },
        {
          id: 'websocket' as DiagnosticCheck['id'],
          status: socket ? 'ok' : 'error',
          expected: null,
          actual: null,
        },
      ]);
    });
    return () => {
      alive = false;
    };
  }, [instance]);
  return checks;
}

/** Simple or advanced, in the window header; remembered on the account (#514). */
export function ServerViewToggle() {
  const { t } = useTranslation();
  const { serverView } = usePreferences();
  return (
    <Segmented
      label={t('server.view.label')}
      value={serverView}
      onChange={(view) => void updatePreferences({ serverView: view }).catch(() => {})}
      options={[
        { value: 'simple', label: t('server.view.simple') },
        { value: 'advanced', label: t('server.view.advanced') },
      ]}
    />
  );
}

/** Settings → Server (#514): health, resources, jobs, people, problems and alerts. */
export function ServerSettings() {
  const { t } = useTranslation();
  const { serverView } = usePreferences();
  const [range, setRange] = useState<ServerRange>('1h');
  const { status, setStatus, error, load } = useServerStatus(range);
  const browserChecks = useBrowserChecks();
  const [actionError, setActionError] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const act = useCallback(
    async (work: () => Promise<unknown>, failure = 'server.problems.actionError') => {
      setActionError(null);
      try {
        await work();
      } catch {
        setActionError(t(failure));
      }
      await load();
    },
    [load, t],
  );
  const checks = [...browserChecks, ...(status?.checks ?? [])];
  const actions: ServerActions = {
    range,
    setRange,
    actionError,
    retry: (p) =>
      act(
        () => api.post(`/instance/server/problems/${encodeURIComponent(p.id)}/retry`, {}),
        'server.problems.retryError',
      ),
    seen: (p) => act(() => api.post(`/instance/server/problems/${encodeURIComponent(p.id)}/seen`, {})),
    retryAll: () => act(() => api.post('/instance/server/problems/retry', {})),
    seenAll: () => act(() => api.post('/instance/server/problems/seen', {})),
    saveAlerts: async (patch) => {
      const current = statusRef.current;
      if (!current) return;
      setStatus({ ...current, alerts: { ...current.alerts, ...patch } });
      try {
        const alerts = await trackSave(api.patch<ServerAlerts>('/instance/server/alerts', patch));
        if (statusRef.current) setStatus({ ...statusRef.current, alerts });
      } catch {
        setStatus(current);
      }
    },
    sendToDevelopers: () => {
      const current = statusRef.current;
      openFeedback({
        title: t('server.problems.reportTitle'),
        ...(current ? { details: technicalSummary(current, checks) } : {}),
      });
    },
  };

  if (error && !status)
    return (
      <p role="alert" className="settings-footnote">
        {t('server.loadError')}
      </p>
    );
  if (!status) return <p role="status">{t('admin.loading')}</p>;
  // A browser check that fails is a problem like a server one.
  const withBrowser: ServerStatus = {
    ...status,
    problems: [
      ...browserChecks
        .filter((c) => c.status !== 'ok')
        .map(
          (c): ServerProblem => ({
            id: `check:${c.id}`,
            kind: 'config_check',
            severity: 'error',
            role: 'web',
            firstAt: status.checkedAt,
            lastAt: status.checkedAt,
            count: 1,
            seen: false,
            retry: false,
            technical: [c.id, c.expected && `expected ${c.expected}`, c.actual && `found ${c.actual}`]
              .filter(Boolean)
              .join(' · '),
            checkId: c.id,
            service: 'configuration',
            file: null,
            board: null,
          }),
        ),
      ...status.problems,
    ],
  };
  return serverView === 'advanced' ? (
    <AdvancedView status={withBrowser} checks={checks} actions={actions} />
  ) : (
    <SimpleView status={withBrowser} checks={checks} actions={actions} />
  );
}
