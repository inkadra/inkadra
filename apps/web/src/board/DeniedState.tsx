// SPDX-License-Identifier: AGPL-3.0-only
import { Button, EmptyState } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { KeptChanges } from './connection.ts';

/**
 * The board did not let this person in (issue 109). There is no access-request API yet
 * (remaining work in issue 109): the clear path is asking the project's managers, with the
 * exact board link copied so the request can carry it.
 */
export function DeniedState() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* Without a clipboard the text above already says whom to ask. */
    }
  };
  return (
    <div className="board-state">
      <EmptyState
        icon="lock"
        title={t('board.denied.title')}
        actions={
          <Button variant="secondary" onClick={() => void copyLink()}>
            {copied ? t('board.denied.copied') : t('board.denied.copy')}
          </Button>
        }
      >
        {t('board.denied.body')}
        {copied && <p role="status">{t('board.denied.hint')}</p>}
      </EmptyState>
    </div>
  );
}

/**
 * The board was deleted, with its project or on its own, or moved to the trash while it was open
 * (#951). Edits it held that the server had not confirmed were set aside (`kept`): they can be
 * downloaded here, or restored once the board is back from the trash.
 */
export function GoneState({
  reason,
  kept,
}: {
  reason: 'deleted' | 'trash';
  kept: KeptChanges | null | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title = t(reason === 'trash' ? 'board.gone.trashTitle' : 'board.gone.deletedTitle');
  // The board under the focus is gone: the focus comes here, where the way back is.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    // Only the focus the board had: one in the sidebar or a dialog stays where it is.
    const active = document.activeElement;
    if (!active || active === document.body) box.current?.focus();
  }, []);
  return (
    <section ref={box} className="board-state" tabIndex={-1} aria-label={title}>
      <EmptyState
        icon="trash"
        title={title}
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/projects')}>
              {t('board.gone.back')}
            </Button>
            {kept && (
              <Button icon="download" onClick={() => void kept.download().catch(() => {})}>
                {t('board.contextual.keptDownload')}
              </Button>
            )}
          </>
        }
      >
        <p>{t(reason === 'trash' ? 'board.gone.trashBody' : 'board.gone.deletedBody')}</p>
        {kept && <p>{t('board.gone.kept')}</p>}
      </EmptyState>
    </section>
  );
}
