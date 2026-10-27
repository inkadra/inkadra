import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useSession } from '../lib/session.tsx';
import './settings.css';

export function SettingsShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const location = useLocation();
  const current = location.pathname + location.search;
  const item = (key: string, to: string) => (
    <Link to={to} aria-current={current === to ? 'page' : undefined}>
      {t(`admin.${key}`)}
    </Link>
  );
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <h2>{t('admin.personal')}</h2>
        {item('account', '/settings')}
        {item('preferences', '/settings?section=preferences')}
        {item('notifications', '/settings?section=notifications')}
        {user?.role === 'admin' && (
          <>
            <h2>{t('admin.workspace')}</h2>
            {item('members', '/settings/team')}
            {item('storage', '/settings?section=workspace')}
            <h2>{t('admin.instance')}</h2>
            {item('branding', '/settings?section=instance')}
            {item('providers', '/settings?section=providers')}
          </>
        )}
      </nav>
      <div className="settings settings--content">{children}</div>
    </div>
  );
}
