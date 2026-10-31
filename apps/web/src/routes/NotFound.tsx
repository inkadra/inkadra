import { EmptyState } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 32 }}>
      <EmptyState icon="search" title={t('notFound.title')}>
        <Link to="/" className="ink-btn ink-btn--secondary">
          {t('notFound.back')}
        </Link>
      </EmptyState>
    </div>
  );
}
