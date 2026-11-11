import { type DemoInfo, type DemoSandbox, TURNSTILE_ACTION } from '@inkadra/shared';
import { Button, Icon, Logo } from '@inkadra/ui';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { formatStorage } from '../routes/StorageCharts.tsx';
import { forgetSandbox, INSTALL_URL, RULES_URL, rememberSandbox } from './demo.ts';
import './demo.css';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Cloudflare Turnstile, when the server has a key: the token goes with "Try the demo". */
function useTurnstile(siteKey: string | null, holder: RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState<string | null>(null);
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey || !holder.current) return;
    const el = holder.current;
    let alive = true;
    const render = () => {
      if (!alive || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(el, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        appearance: 'interaction-only',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback': () => setToken(null),
      });
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = render;
      document.head.append(script);
    }
    return () => {
      alive = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, holder]);
  const reset = () => {
    setToken(null);
    if (widget.current) window.turnstile?.reset(widget.current);
  };
  return { token, reset };
}

type Problem = 'full' | 'wait' | 'check' | 'failed';

/** The sign-in page of the demo (decision 0084): one button, the rules above it. */
export function DemoStart({ demo }: { demo: DemoInfo }) {
  const { t, i18n } = useTranslation();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const holder = useRef<HTMLDivElement>(null);
  const turnstile = useTurnstile(demo.turnstileSiteKey, holder);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(demo.full ? 'full' : null);
  const hours = demo.ttlSeconds / 3600;
  const duration = Number.isInteger(hours)
    ? t('demo.hours', { count: hours })
    : t('demo.minutes', { count: Math.round(demo.ttlSeconds / 60) });
  const waiting = demo.turnstileSiteKey !== null && !turnstile.token;

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const sandbox = await api.post<DemoSandbox>(
        '/demo/sandbox',
        turnstile.token ? { turnstileToken: turnstile.token } : {},
      );
      rememberSandbox(sandbox);
      // Signed in, the sign-in page goes to its `next`: the sample project.
      if (sandbox.projectId)
        navigate(`/login?next=${encodeURIComponent(`/p/${sandbox.projectId}`)}`, { replace: true });
      await refresh();
    } catch (err) {
      const reason =
        err instanceof RequestError
          ? (err.details as { reason?: string } | undefined)?.reason
          : undefined;
      setProblem(
        reason === 'demo_full'
          ? 'full'
          : reason === 'demo_wait'
            ? 'wait'
            : reason === 'turnstile'
              ? 'check'
              : 'failed',
      );
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login__card demo-card">
      <div className="demo-card__logo">
        <Logo size={28} />
        {t('demo.brand')}
      </div>
      <h1 className="demo-card__title">{t('demo.title')}</h1>
      <p className="demo-card__lead">{t('demo.lead')}</p>
      <ul className="demo-card__rules">
        <li>
          <Trans i18nKey="demo.ruleTime" values={{ duration }} components={{ b: <b /> }} />
        </li>
        <li>
          <Trans
            i18nKey="demo.ruleSpace"
            values={{
              total: formatStorage(demo.storageBytes, i18n.language),
              file: formatStorage(demo.fileBytes, i18n.language),
            }}
            components={{ b: <b /> }}
          />
        </li>
        <li>{t('demo.rulePrivate')}</li>
      </ul>
      {problem && (
        <p
          className={`demo-banner demo-banner--${problem === 'full' || problem === 'wait' ? 'warn' : 'danger'}`}
          role={problem === 'full' || problem === 'wait' ? 'status' : 'alert'}
        >
          <Icon name={problem === 'full' || problem === 'wait' ? 'clock' : 'warning'} size={14} />
          <span>
            {problem === 'full'
              ? t('demo.full', { count: demo.maxSandboxes })
              : t(`demo.problem.${problem}`)}
          </span>
        </p>
      )}
      <div ref={holder} className="demo-card__check" />
      <Button
        variant="primary"
        size="lg"
        block
        icon="play"
        disabled={waiting || problem === 'full'}
        busy={busy}
        onClick={() => void start()}
      >
        {t('demo.start')}
      </Button>
      <div className="demo-card__or">{t('demo.or')}</div>
      <a className="ink-btn ink-btn--secondary ink-btn--lg ink-btn--block" href={INSTALL_URL}>
        <Icon name="download" size={14} />
        {t('demo.installServer')}
      </a>
      <p className="demo-card__fine">
        <Trans
          i18nKey="demo.accept"
          components={{
            // biome-ignore lint/a11y/useAnchorContent: Trans fills it with the link text.
            rules: <a href={RULES_URL} target="_blank" rel="noopener" />,
          }}
        />
      </p>
    </main>
  );
}

/** What every open page shows once the sandbox is gone. */
export function DemoEnded({ onAgain }: { onAgain: () => void }) {
  const { t } = useTranslation();
  const { user, refresh } = useSession();
  const again = async () => {
    // The sweep may not have run yet: the old sandbox goes now.
    if (user) await api.delete('/demo/sandbox').catch(() => {});
    forgetSandbox();
    await refresh();
    onAgain();
  };
  return (
    <main className="demo-end" role="alertdialog" aria-labelledby="demo-end-title">
      <span className="demo-end__icon">
        <Icon name="clock" size={20} />
      </span>
      <h1 id="demo-end-title" className="demo-end__title">
        {t('demo.endedTitle')}
      </h1>
      <p className="demo-end__text">{t('demo.endedText')}</p>
      <div className="demo-end__actions">
        <Button variant="primary" size="lg" icon="play" onClick={() => void again()}>
          {t('demo.again')}
        </Button>
        <a className="ink-btn ink-btn--secondary ink-btn--lg" href={INSTALL_URL}>
          <Icon name="download" size={14} />
          {t('demo.installServer')}
        </a>
      </div>
      <p className="demo-card__fine">{t('demo.cloud')}</p>
    </main>
  );
}
