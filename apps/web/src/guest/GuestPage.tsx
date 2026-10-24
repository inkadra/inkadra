import type { GuestSession, ShareLinkPreview } from '@inkadra/shared';
import { Button, Logo, TextField, Wordmark } from '@inkadra/ui';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { resetAssetCache, setAssetLoader } from '../board/assets.ts';
import { guestApi } from './api.ts';
import { GuestBoardScreen } from './GuestBoard.tsx';
import { failureOf, onNoSession, type Stop } from './model.ts';
import '../routes/login.css';
import './guest.css';

type Gate =
  | { kind: 'loading' }
  | { kind: 'stop'; stop: Stop }
  | { kind: 'password'; preview: ShareLinkPreview; changed: boolean }
  | { kind: 'ready'; preview: ShareLinkPreview; session: GuestSession };

/** Keeps the page out of search engines and away from every account endpoint. */
function useGuestDocument() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    // The server sends Referrer-Policy too; this holds if a proxy drops the header.
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.append(meta, referrer);
    // Files come from the snapshot; anything else is not for guests.
    setAssetLoader(async () => null);
    return () => {
      meta.remove();
      referrer.remove();
      setAssetLoader(null);
      resetAssetCache();
    };
  }, []);
}

/**
 * /s/:token, the page of a share link for people without an account (decision 0013): the
 * preview, the password if the link has one, then the board as a read-only snapshot.
 */
export function GuestPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  // When the page last opened the link again because the server did not know the session.
  const reopened = useRef<number | null>(null);
  useGuestDocument();

  const start = useCallback(async () => {
    let preview: ShareLinkPreview;
    try {
      preview = await guestApi.preview(token);
    } catch (err) {
      const f = failureOf(err);
      setGate({ kind: 'stop', stop: f.kind === 'stop' ? f.stop : 'error' });
      return;
    }
    if (preview.needsPassword) {
      // A guest who entered the password before keeps their session until it expires.
      try {
        const session = await guestApi.session(preview.linkId);
        setGate({ kind: 'ready', preview, session });
      } catch {
        setGate({ kind: 'password', preview, changed: false });
      }
      return;
    }
    try {
      const session = await guestApi.open(preview.linkId, { token });
      setGate({ kind: 'ready', preview, session });
    } catch (err) {
      const f = failureOf(err);
      if (f.kind === 'password') setGate({ kind: 'password', preview, changed: false });
      else setGate({ kind: 'stop', stop: f.kind === 'stop' ? f.stop : 'error' });
    }
  }, [token]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    const title = gate.kind === 'ready' ? gate.preview.boardTitle : null;
    const instance =
      gate.kind === 'loading' || gate.kind === 'stop' ? null : gate.preview.instanceName;
    document.title = [title, instance ?? 'Inkadra'].filter(Boolean).join(' · ');
  }, [gate]);

  if (gate.kind === 'loading') {
    return (
      <GateCard>
        <p className="ink-muted guest-gate__text" role="status">
          {t('guest.loading')}
        </p>
      </GateCard>
    );
  }
  if (gate.kind === 'stop') return <StopScreen stop={gate.stop} />;
  if (gate.kind === 'password') {
    return (
      <PasswordForm
        token={token}
        preview={gate.preview}
        changed={gate.changed}
        onOpened={(session) => setGate({ kind: 'ready', preview: gate.preview, session })}
        onStop={(stop) => setGate({ kind: 'stop', stop })}
      />
    );
  }
  return (
    <GuestBoardScreen
      key={gate.session.guest.id}
      preview={gate.preview}
      session={gate.session}
      onSession={(session) => setGate({ ...gate, session })}
      onStop={(stop) => {
        if (stop !== 'no_session') setGate({ kind: 'stop', stop });
        else if (onNoSession(reopened.current, Date.now(), navigator.cookieEnabled) === 'cookies')
          setGate({ kind: 'stop', stop: 'cookies' });
        else {
          reopened.current = Date.now();
          void start();
        }
      }}
      onPasswordChanged={() => setGate({ kind: 'password', preview: gate.preview, changed: true })}
    />
  );
}

function GateCard({ children, heading }: { children: ReactNode; heading?: string }) {
  return (
    <div className="login guest-gate">
      <div className="login__dots" aria-hidden="true" />
      <main className="login__card">
        <div className="login__brand">
          <Logo size={48} />
          {heading ? (
            <h1 className="login__title guest-gate__title">{heading}</h1>
          ) : (
            <h1 className="login__title">
              <Wordmark />
            </h1>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

function StopScreen({ stop }: { stop: Stop }) {
  const { t } = useTranslation();
  return (
    <GateCard heading={t(`guest.stop.${stop}.title`)}>
      <p className="guest-gate__text">{t(`guest.stop.${stop}.body`)}</p>
      {(stop === 'rate_limited' || stop === 'error' || stop === 'cookies') && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('guest.retry')}
        </Button>
      )}
    </GateCard>
  );
}

function PasswordForm({
  token,
  preview,
  changed,
  onOpened,
  onStop,
}: {
  token: string;
  preview: ShareLinkPreview;
  changed: boolean;
  onOpened: (session: GuestSession) => void;
  onStop: (stop: Stop) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each failed attempt clears the field and puts the cursor back in it.
  const [attempts, setAttempts] = useState(0);
  const field = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus after every attempt
  useEffect(() => {
    field.current?.querySelector('input')?.focus();
  }, [attempts]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await guestApi.open(preview.linkId, { token, password }));
      return;
    } catch (err) {
      const f = failureOf(err);
      if (f.kind === 'stop' && f.stop !== 'rate_limited') {
        onStop(f.stop);
        return;
      }
      setError(
        f.kind === 'password'
          ? t('guest.password.wrong')
          : f.kind === 'stop'
            ? t('guest.password.tooMany')
            : f.kind === 'transient'
              ? t('guest.errors.offline')
              : t('guest.errors.generic'),
      );
      if (f.kind === 'password' || f.kind === 'stop') setPassword('');
      setAttempts((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateCard heading={t('guest.password.title')}>
      <form className="guest-gate__form" onSubmit={submit}>
        <p className="guest-gate__text">
          {changed
            ? t('guest.password.changed')
            : t('guest.password.body', { instance: preview.instanceName })}
        </p>
        <div ref={field}>
          <TextField
            label={t('guest.password.label')}
            type="password"
            // Not the password of an account: keeps browsers from filling in or saving the
            // site's login password here.
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" block disabled={busy || !password}>
          {t('guest.password.open')}
        </Button>
      </form>
    </GateCard>
  );
}
