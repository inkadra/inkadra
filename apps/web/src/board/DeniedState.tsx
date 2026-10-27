// SPDX-License-Identifier: AGPL-3.0-only
import { Button, EmptyState } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
