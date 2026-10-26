import { Icon } from '@inkadra/ui';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

export function MobileNavigation({
  inboxButtonRef,
  pathname,
  inboxOpen,
  drawerOpen,
  unread,
  onHome,
  onProjects,
  onNew,
  onInbox,
  onProfile,
}: {
  inboxButtonRef?: Ref<HTMLButtonElement>;
  pathname: string;
  inboxOpen: boolean;
  drawerOpen: boolean;
  unread: number;
  onHome: () => void;
  onProjects: () => void;
  onNew: () => void;
  onInbox: () => void;
  onProfile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="mobile-bottom-nav" aria-label={t('mobile.navigation')}>
      <button
        type="button"
        aria-current={pathname === '/' && !inboxOpen && !drawerOpen ? 'page' : undefined}
        onClick={onHome}
      >
        <Icon name="home" />
        {t('nav.home')}
      </button>
      <button type="button" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={onProjects}>
        <Icon name="board" />
        {t('nav.projects')}
      </button>
      <button
        type="button"
        className="mobile-bottom-nav__new"
        aria-label={t('nav.newProject')}
        onClick={onNew}
      >
        <Icon name="plus" />
        {t('mobile.new')}
      </button>
      <button
        ref={inboxButtonRef}
        aria-label={unread > 0 ? t('notifications.bell', { count: unread }) : t('nav.inbox')}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={inboxOpen}
        onClick={onInbox}
      >
        <Icon name="inbox" />
        {t('nav.inbox')}
        {unread > 0 && <span className="mobile-bottom-nav__badge">{unread}</span>}
      </button>
      <button
        type="button"
        aria-current={
          pathname.startsWith('/settings') && !inboxOpen && !drawerOpen ? 'page' : undefined
        }
        onClick={onProfile}
      >
        <Icon name="settings" />
        {t('mobile.profile')}
      </button>
    </nav>
  );
}
