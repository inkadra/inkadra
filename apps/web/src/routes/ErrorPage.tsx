// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Icon } from '@inkadra/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { FeedbackLauncher } from '../feedback/Feedback.tsx';
import { openFeedback, useFeedbackStatus } from '../feedback/state.ts';
import { isChunkError } from '../lib/chunks.ts';
import { NoSessionProvider } from '../lib/session.tsx';
import './error.css';

/** Short reference for support: random per crash, not a hash of anything sensitive. */
function newErrorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/**
 * The page reference for "Copy details": query string and hash are dropped (they can carry
 * a reset-password token) and the raw share/invitation token after /s/ or /join/ is
 * redacted, so a copied report can never leak credentials.
 */
function redactPage(href: string): string {
  const bare = href.split(/[#?]/)[0] ?? href;
  return bare.replace(/\/(s|join)\/[^/]+/g, '/$1/[redacted]');
}

/** What "Copy details" hands over: enough to report, nothing more. */
function errorDetails(error: unknown, id: string): string {
  const details: Record<string, unknown> = {
    errorId: id,
    at: new Date().toISOString(),
    page: redactPage(window.location.href),
    userAgent: navigator.userAgent,
  };
  if (isRouteErrorResponse(error)) {
    details.status = error.status;
    details.message = error.statusText;
  } else if (error instanceof Error) {
    details.message = error.message;
    details.stack = error.stack;
  } else {
    details.message = String(error);
  }
  return JSON.stringify(details, null, 2);
}

/**
 * Router-level error page (issue 109): every render error of the app lands here, calm message,
 * retry, copyable details and an error ID instead of the framework default page.
 */
export function ErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const [copied, setCopied] = useState(false);
  // One ID per crash, created once: copies made from the same screen stay consistent.
  const [id] = useState(newErrorId);
  useEffect(() => {
    // Log with the ID so the on-screen reference matches what the console captured.
    console.error(`App error ${id}`, error);
  }, [error, id]);
  const details = useMemo(() => errorDetails(error, id), [error, id]);
  const reporting = !!useFeedbackStatus()?.enabled;
  // A part of the app missing after a deploy is an update, not a bug (#832).
  const update = isChunkError(error);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      /* Without a clipboard the error ID on screen is still reportable. */
    }
  };
  return (
    <div className="app-error">
      <div className="ink-empty">
        <Icon name="warning" />
        <h1 className="app-error__title">
          {t(update ? 'appError.updateTitle' : 'appError.title')}
        </h1>
        <p className="app-error__msg" role="alert">
          {t(update ? 'appError.updateBody' : 'appError.body')}
        </p>
        <p className="app-error__hint">{t('appError.hint')}</p>
        <div className="ink-empty__actions">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t('appError.retry')}
          </Button>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? t('appError.copied') : t('appError.copy')}
          </Button>
          {reporting && (
            <Button
              onClick={() =>
                openFeedback({ title: t('feedback.prefilledTitle'), details, errorId: id })
              }
            >
              {t('feedback.reportThis')}
            </Button>
          )}
        </div>
        {copied && (
          <p className="app-error__hint" role="status">
            {t('appError.copied')}
          </p>
        )}
      </div>
      <code className="app-error__id">{t('appError.id', { id })}</code>
      {/* Nobody signed in: the status request is refused and the button above stays hidden. */}
      <NoSessionProvider>
        <FeedbackLauncher />
      </NoSessionProvider>
    </div>
  );
}

/**
 * The first load could not reach the server (#821): a deploy, a restart, the network. The
 * session tries again by itself; Retry tries at once.
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="app-error">
      <div className="ink-empty">
        <Icon name="warning" />
        <h1 className="app-error__title">{t('appError.unreachableTitle')}</h1>
        <p className="app-error__msg" role="alert">
          {t('appError.unreachableBody')}
        </p>
        <div className="ink-empty__actions">
          <Button variant="primary" onClick={onRetry}>
            {t('appError.retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
