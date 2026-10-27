// SPDX-License-Identifier: AGPL-3.0-only
import { Button, EmptyState } from '@inkadra/ui';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import './error.css';

/** Short reference for support: random per crash, not a hash of anything sensitive. */
function newErrorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** What "Copy details" hands over: enough to report, nothing more. */
function errorDetails(error: unknown, id: string): string {
  const details: Record<string, unknown> = {
    errorId: id,
    at: new Date().toISOString(),
    page: window.location.href,
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
  // One ID per crash: copies made from the same screen stay consistent.
  const idRef = useRef(newErrorId());
  const details = useMemo(() => errorDetails(error, idRef.current), [error]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      /* Without a clipboard the error ID on screen is still reportable. */
    }
  };
  return (
    <div className="app-error" role="alert">
      <EmptyState
        icon="warning"
        title={t('appError.title')}
        actions={
          <>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('appError.retry')}
            </Button>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? t('appError.copied') : t('appError.copy')}
            </Button>
          </>
        }
      >
        {t('appError.body')}
        <p className="app-error__hint">{t('appError.hint')}</p>
      </EmptyState>
      <code className="app-error__id">{t('appError.id', { id: idRef.current })}</code>
    </div>
  );
}
