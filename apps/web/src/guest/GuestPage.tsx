import type { GuestSession, ShareLinkPreview } from '@inkadra/shared';
import { Button, Logo, TextField, Wordmark } from '@inkadra/ui';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { setAssetLoader } from '../board/assets.ts';
import { guestApi } from './api.ts';
import { GuestBoardScreen } from './GuestBoard.tsx';
import { failureOf, type Stop } from './model.ts';
import '../routes/login.css';
import './guest.css';

type Gate =
  | { kind: 'loading' }
  | { kind: 'stop'; stop: Stop }
  | { kind: 'password'; preview: ShareLinkPreview; wrong: boolean; changed: boolean }
  | { kind: 'ready'; preview: ShareLinkPreview; session: GuestSession };

/** Keeps the page out of search engines and away from every account endpoint. */
function useGuestDocument() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    // Files come from the snapshot; anything else is not for guests.
    setAssetLoader(async () => null);
    return () => {
      meta.remove();
      setAssetLoader(null);
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
        setGate({ kind: 'password', preview, wrong: false, changed: false });
      }
      return;
    }
    try {
      const session = await guestApi.open(preview.linkId, { token });
      setGate({ kind: 'ready', preview, session });
    } catch (err) {
      const f = failureOf(err);
      if (f.kind === 'password')
        setGate({ kind: 'password', preview, wrong: false, changed: false });
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
        wrong={gate.wrong}
        changed={gate.changed}
        onOpened={(session) => setGate({ kind: 'ready', preview: gate.preview, session })}
        onWrong={() => setGate({ ...gate, wrong: true, changed: false })}
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
        if (stop === 'no_session') void start();
        else setGate({ kind: 'stop', stop });
      }}
      onPasswordChanged={() =>
        setGate({ kind: 'password', preview: gate.preview, wrong: false, changed: true })
      }
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
      {(stop === 'rate_limited' || stop === 'error') && (
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
  wrong,
  changed,
  onOpened,
  onWrong,
  onStop,
}: {
  token: string;
  preview: ShareLinkPreview;
  wrong: boolean;
  changed: boolean;
  onOpened: (session: GuestSession) => void;
  onWrong: () => void;
  onStop: (stop: Stop) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wrong) setPassword('');
    field.current?.querySelector('input')?.focus();
  }, [wrong]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await guestApi.open(preview.linkId, { token, password }));
    } catch (err) {
      const f = failureOf(err);
      if (f.kind === 'password') onWrong();
      else if (f.kind === 'stop' && f.stop === 'rate_limited')
        setError(t('guest.password.tooMany'));
      else if (f.kind === 'stop') onStop(f.stop);
      else setError(t('guest.errors.generic'));
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
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={wrong ? t('guest.password.wrong') : error}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" block disabled={busy || !password}>
          {t('guest.password.open')}
        </Button>
      </form>
    </GateCard>
  );
}
