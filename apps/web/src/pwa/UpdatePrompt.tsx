import { Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { dismissUpdate, useUpdate } from './register.ts';
import './pwa.css';

/** "New version available — Update": small, out of the way, never blocking. */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const update = useUpdate();
  if (!update) return null;
  return (
    <div className="pwa-update" role="status">
      <span>{t('pwa.updateAvailable')}</span>
      <button type="button" className="pwa-update__action" onClick={update}>
        {t('pwa.update')}
      </button>
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
