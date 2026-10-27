/** Shared identity for the page heading and the global settings breadcrumb. */
export function settingsSection(pathname: string, search: string) {
  if (pathname === '/settings/team')
    return { id: 'members', title: 'admin.members', lead: 'admin.teamHelp' };
  const section = new URLSearchParams(search).get('section');
  switch (section) {
    case 'preferences':
      return { id: section, title: 'admin.preferences', lead: 'settings.sectionLead.preferences' };
    case 'notifications':
      return {
        id: section,
        title: 'admin.notifications',
        lead: 'settings.sectionLead.notifications',
      };
    case 'workspace':
      return { id: section, title: 'admin.storage', lead: 'settings.sectionLead.workspace' };
    case 'instance':
      return { id: section, title: 'admin.branding', lead: 'settings.sectionLead.instance' };
    case 'providers':
      return { id: section, title: 'admin.providers', lead: 'settings.sectionLead.providers' };
    default:
      return { id: 'account', title: 'settings.title', lead: 'settings.lead' };
  }
}
