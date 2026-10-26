import {
  CAPABILITIES,
  type GuestRole,
  guestCapabilities,
  type ProjectRole,
  roleCapabilities,
} from '@inkadra/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Guest rows describe the current link draft, including its original-download option. */
export function PermissionsMatrix({
  selectedRole,
  guest,
}: {
  selectedRole?: ProjectRole;
  guest?: { role: GuestRole; proofing: boolean; allowDownload: boolean };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const roles: ProjectRole[] = ['owner', 'editor', 'commenter', 'viewer'];
  const rows = guest
    ? [
        {
          role: guest.role,
          active: true,
          rights: guestCapabilities(guest),
          label: t(`guestLinks.roles.${guest.role}`),
        },
      ]
    : roles.map((role) => ({
        role,
        active: role === selectedRole,
        rights: roleCapabilities(role),
        label: t(`roles.${role}`),
      }));
  return (
    <div className="share__matrix-wrapper">
      <button
        type="button"
        className="share__matrix-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('share.matrix.title')}
      </button>
      {open && (
        <div className="share__matrix-card">
          <table className="share__matrix-table">
            <thead>
              <tr>
                <th scope="col">{t('share.matrix.role')}</th>
                {CAPABILITIES.map((capability) => (
                  <th scope="col" key={capability}>
                    {t(`share.matrix.${capability}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.role}
                  className={row.active ? 'is-active' : undefined}
                  aria-current={row.active ? 'true' : undefined}
                >
                  <th scope="row">{row.label}</th>
                  {row.rights.map((allowed, index) => (
                    <td key={CAPABILITIES[index]}>
                      {t(allowed ? 'share.matrix.yes' : 'share.matrix.no')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
