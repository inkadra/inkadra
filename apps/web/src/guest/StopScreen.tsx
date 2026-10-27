// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Logo, Wordmark } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stop } from './model.ts';

/** The gate card every guest gate screen is built on: brand, optional heading, one content. */
export function GateCard({ children, heading }: { children: ReactNode; heading?: string }) {
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

/** Stops where the link is dead for good and only a new one can help (issue 109). */
const DEAD_LINK_STOPS: readonly Stop[] = ['not_found', 'expired', 'revoked', 'unavailable'];

/** What a guest sees when the board cannot open: calm text and the way out of each state. */
export function StopScreen({ stop }: { stop: Stop }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Copy-only (no backend yet): the link goes to the clipboard so a message to whoever
  // shared the board can carry it, and the exact dead link, to whoever can make a new one.
  const askNewLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* Without a clipboard the text above already points to the sender. */
    }
  };
  return (
    <GateCard heading={t(`guest.stop.${stop}.title`)}>
      <p className="guest-gate__text">{t(`guest.stop.${stop}.body`)}</p>
      {(stop === 'rate_limited' || stop === 'error' || stop === 'cookies') && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('guest.retry')}
        </Button>
      )}
      {DEAD_LINK_STOPS.includes(stop) && (
        <>
          <Button variant="primary" onClick={() => void askNewLink()}>
            {copied ? t('guest.askLink.copied') : t('guest.askLink.button')}
          </Button>
          {copied && (
            <p className="guest-gate__text" role="status">
              {t('guest.askLink.hint')}
            </p>
          )}
        </>
      )}
    </GateCard>
  );
}
