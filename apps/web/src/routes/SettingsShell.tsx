import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useSession } from '../lib/session.tsx';
import './settings.css';

export function SettingsShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationId = useId();
  const section = new URLSearchParams(location.search).get('section');
  const current =
    location.pathname === '/settings/team'
      ? '/settings/team'
      : section &&
          ['preferences', 'notifications', 'workspace', 'instance', 'providers'].includes(section)
        ? `/settings?section=${section}`
        : '/settings';
  const item = (key: string, to: string) => (
    <Link to={to} aria-current={current === to ? 'page' : undefined}>
      {t(`admin.${key}`)}
    </Link>
  );
  return (
    <div className="settings-layout">
      <label className="settings-mobile-nav" htmlFor={navigationId}>
        <span>{t('nav.settings')}</span>
        <select
          id={navigationId}
          className="ink-input"
          value={current}
          onChange={(event) => navigate(event.target.value)}
        >
          <optgroup label={t('admin.personal')}>
            <option value="/settings">{t('admin.account')}</option>
            <option value="/settings?section=preferences">{t('admin.preferences')}</option>
            <option value="/settings?section=notifications">{t('admin.notifications')}</option>
          </optgroup>
          {user?.role === 'admin' && (
            <>
              <optgroup label={t('admin.workspace')}>
                <option value="/settings/team">{t('admin.members')}</option>
                <option value="/settings?section=workspace">{t('admin.storage')}</option>
              </optgroup>
              <optgroup label={t('admin.instance')}>
                <option value="/settings?section=instance">{t('admin.branding')}</option>
                <option value="/settings?section=providers">{t('admin.providers')}</option>
              </optgroup>
            </>
          )}
        </select>
      </label>
      <nav className="settings-nav" aria-label={t('nav.settings')}>
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
