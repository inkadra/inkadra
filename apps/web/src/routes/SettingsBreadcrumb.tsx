import { Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { GROUP_TITLES, isSettingsHome, settingsSection } from './settings-sections.ts';

export function SettingsBreadcrumb({ pathname, search }: { pathname: string; search: string }) {
  const { t } = useTranslation();
  if (isSettingsHome(pathname, search))
    return (
      <span aria-current="page" style={{ fontWeight: 600 }}>
        {t('nav.settings')}
      </span>
    );
  const section = settingsSection(pathname, search);
  return (
    <>
      <Link to="/settings">{t('nav.settings')}</Link>
      <Icon name="chevronRight" size={12} />
      <span className="settings-crumb__group">{t(GROUP_TITLES[section.group])}</span>
      <Icon name="chevronRight" size={12} />
      <span aria-current="page" style={{ fontWeight: 600 }}>
        {t(section.title)}
      </span>
    </>
  );
}
