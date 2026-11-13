import type {
  DiagnosticCheck,
  ServerAlerts,
  ServerLive,
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
import { mergeLive, peekProblem, type ServerActions, technicalSummary, usePeek } from './common.ts';
import { SimpleView } from './SimpleView.tsx';
import './server.css';

/** The full status (sums of the space, backup, queues, problems…) every 30 s. */
export const FULL_MS = 30_000;
/** The values of now and the newest points, from the monitor store alone, every 2.5 s. */
export const LIVE_MS = 2_500;

/**
 * Status of the instance while the page is on screen: the full status every 30 s, at once on a
 * new range or after an action, and the live values in between. Nothing is asked while the tab
 * is hidden, and a tick never starts while a request is on its way. Only the newest full
 * request counts, so a slow answer for the range before never replaces the one just chosen,
 * and a live answer older than it is dropped.
 */
export function useServerStatus(range: ServerRange) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const latest = useRef(0);
  const waiting = useRef(false);
  const load = useCallback(async () => {
    const id = ++latest.current;
    waiting.current = true;
    try {
      const next = await api.get<ServerStatus>(`/instance/server?range=${range}`);
      if (id !== latest.current) return;
      setStatus(next);
      setUpdatedAt(Date.now());
      setError(false);
    } catch {
      if (id === latest.current) setError(true);
    } finally {
      if (id === latest.current) waiting.current = false;
    }
  }, [range]);
  const live = useCallback(async () => {
    const id = latest.current;
    waiting.current = true;
    try {
      const next = await api.get<ServerLive>(`/instance/server/live?range=${range}`);
      if (id !== latest.current) return;
      setStatus((current) => (current ? mergeLive(current, next) : current));
      setUpdatedAt(Date.now());
    } catch {
      // The next full reading says what is wrong; a live tick only skips.
    } finally {
      if (id === latest.current) waiting.current = false;
    }
  }, [range]);
  useEffect(() => {
    void load();
    let full = Date.now();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || waiting.current) return;
      if (Date.now() - full >= FULL_MS) {
        full = Date.now();
        void load();
      } else void live();
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [load, live]);
  return { status, setStatus, error, load, updatedAt };
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

/**
 * The view on screen: the one remembered on the account, or Advanced while a problem of the
 * Simple view is shown in its error log (not saved).
 */
export function useServerView(): 'simple' | 'advanced' {
  const { serverView } = usePreferences();
  return usePeek() !== null ? 'advanced' : serverView;
}

/** Simple or advanced, in the window header; remembered on the account (#514). */
export function ServerViewToggle() {
  const { t } = useTranslation();
  const view = useServerView();
  return (
    <span data-tour="server-view">
      <Segmented
        label={t('server.view.label')}
        value={view}
        onChange={(next) => {
          peekProblem(null);
          void updatePreferences({ serverView: next }).catch(() => {});
        }}
        options={[
          { value: 'simple', label: t('server.view.simple') },
          { value: 'advanced', label: t('server.view.advanced') },
        ]}
      />
    </span>
  );
}

/** Settings → Server (#514): health, resources, jobs, people, problems and alerts. */
export function ServerSettings() {
  const { t } = useTranslation();
  const serverView = useServerView();
  const [range, setRange] = useState<ServerRange>('1h');
  const { status, setStatus, error, load, updatedAt } = useServerStatus(range);
  // A problem shown in Advanced from the Simple view: back to the saved view on leaving.
  useEffect(() => () => peekProblem(null), []);
  // The simple view has no period: the hour, the lightest full reading with a curve.
  useEffect(() => {
    if (serverView === 'simple' && range !== '1h') setRange('1h');
  }, [serverView, range]);
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
    updatedAt,
    retry: (p) =>
      act(
        () => api.post(`/instance/server/problems/${encodeURIComponent(p.id)}/retry`, {}),
        'server.problems.retryError',
      ),
    seen: (p) =>
      act(() => api.post(`/instance/server/problems/${encodeURIComponent(p.id)}/seen`, {})),
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
            technical: [
              c.id,
              c.expected && `expected ${c.expected}`,
              c.actual && `found ${c.actual}`,
            ]
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
  return (
    <div className="server-page">
      {serverView === 'advanced' ? (
        <AdvancedView status={withBrowser} checks={checks} actions={actions} />
      ) : (
        <SimpleView status={withBrowser} checks={checks} actions={actions} />
      )}
    </div>
  );
}
