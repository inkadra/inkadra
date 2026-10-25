import { Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { applyUpdate, dismissUpdate, useUpdate } from './register.ts';
import './pwa.css';

/**
 * "New version available — Update": small, out of the way, never blocking. While the board
 * is saving or an upload can still run (also a failed one, until retried or cancelled), the
 * update waits for them and says so.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const update = useUpdate();
  if (!update) return null;
  return (
    <div className="pwa-update" role="status">
      {update.deferred ? (
        <span>{t('pwa.updateWhenSaved')}</span>
      ) : (
        <>
          <span>{t('pwa.updateAvailable')}</span>
          <button type="button" className="pwa-update__action" onClick={applyUpdate}>
            {t('pwa.update')}
          </button>
        </>
      )}
      <button
        type="button"
        className="pwa-update__close"
        aria-label={t('pwa.later')}
        title={t('pwa.later')}
        onClick={dismissUpdate}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
