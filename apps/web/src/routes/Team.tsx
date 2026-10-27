import type { InstanceMember, Invitation, InvitationResult } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { SettingsShell } from './SettingsShell.tsx';

export function Team() {
  const { user, instance, refresh } = useSession();
  const { t, i18n } = useTranslation();
  const [members, setMembers] = useState<InstanceMember[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState<InstanceMember | null>(null);
  const admin = user?.role === 'admin';
  const load = useCallback(async () => {
    const [people, pending] = await Promise.all([
      api.get<{ items: InstanceMember[] }>('/instance/members'),
      api.get<{ items: Invitation[] }>('/invitations'),
    ]);
    setMembers(people.items);
    setInvitations(pending.items.filter((i) => i.projectId === null && i.boardId === null));
  }, []);
  useEffect(() => {
    if (admin) void load().catch(() => setError(t('auth.errors.generic')));
  }, [admin, load, t]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      await refresh();
      setNotice(t('settings.saved'));
    } catch (e) {
      setError(
        t(e instanceof RequestError && e.status === 409 ? 'admin.conflict' : 'auth.errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };
  const update = (id: string, patch: object) =>
    run(() => api.patch(`/instance/members/${id}`, patch));
  const admins = members?.filter((m) => m.role === 'admin' && !m.deactivatedAt).length ?? 0;
  const filtered = members?.filter(
    (m) =>
      (role === 'all' || m.role === role) &&
      `${m.name} ${m.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const date = (value: string) =>
    new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <SettingsShell>
      <h1 className="settings__title">{t('admin.members')}</h1>
      {!admin ? (
        <p role="alert">{t('admin.forbidden')}</p>
      ) : (
        <>
          <p className="ink-muted">{t('admin.teamHelp')}</p>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="team-tools">
            <TextField
              label={t('admin.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="settings__label">
              {t('admin.role')}
              <select className="ink-input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="all">{t('admin.all')}</option>
                <option value="admin">{t('admin.roles.admin')}</option>
                <option value="member">{t('admin.roles.member')}</option>
              </select>
            </label>
          </div>
          {members === null ? (
            <p role="status">{t('admin.loading')}</p>
          ) : (
            <div className="team-table-wrap">
              <table className="team-table">
                <caption>{t('admin.membersCount', { count: members.length })}</caption>
                <thead>
                  <tr>
                    {['person', 'role', 'projects', 'lastActive', 'status', 'actions'].map(
                      (key) => (
                        <th key={key} scope="col">
                          {t(`admin.${key}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered?.map((m) => {
                    const last = m.role === 'admin' && !m.deactivatedAt && admins <= 1;
                    return (
                      <tr key={m.id}>
                        <th scope="row">
                          {m.name}
                          <span className="settings__sub">{m.email}</span>
                        </th>
                        <td>
                          <select
                            className="ink-input"
                            aria-label={t('admin.roleFor', { name: m.name })}
                            value={m.role}
                            disabled={busy || last}
                            title={last ? t('admin.lastAdmin') : undefined}
                            onChange={(e) => void update(m.id, { role: e.target.value })}
                          >
                            <option value="admin">{t('admin.roles.admin')}</option>
                            <option value="member">{t('admin.roles.member')}</option>
                          </select>
                        </td>
                        <td>{m.projectsCount}</td>
                        <td>{m.lastActiveAt ? date(m.lastActiveAt) : t('admin.never')}</td>
                        <td>{t(m.deactivatedAt ? 'admin.inactive' : 'admin.active')}</td>
                        <td>
                          <Button
                            variant="ghost"
                            disabled={busy || last}
                            title={last ? t('admin.lastAdmin') : undefined}
                            onClick={() =>
                              m.deactivatedAt
                                ? void update(m.id, { active: true })
                                : setDeactivating(m)
                            }
                          >
                            {t(m.deactivatedAt ? 'admin.reactivate' : 'admin.deactivate')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered?.length === 0 && <p>{t('admin.noMembers')}</p>}
            </div>
          )}
          <p className="ink-muted">{t('admin.activityHelp')}</p>
          <section className="team-invite">
            <h2>{t('admin.invite')}</h2>
            <p className="ink-muted">{t('admin.inviteHelp')}</p>
            <form
              className="settings__inline"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await api.post<InvitationResult>('/invitations', {
                    kind: 'email',
                    email: email.trim(),
                  });
                  if (result.status !== 'invited')
                    throw new Error('Unexpected instance invitation response');
                  setCreated(result.invitation);
                  setEmail('');
                });
              }}
            >
              <TextField
                label={t('auth.email')}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
                {t('admin.invite')}
              </Button>
            </form>
            {created && (
              <div role="status">
                <p>{t(created.emailSent ? 'admin.inviteSent' : 'admin.shareInvite')}</p>
                {created.url && (
                  <TextField label={t('admin.inviteUrl')} readOnly value={created.url} />
                )}
              </div>
            )}
            <h3>{t('admin.pending')}</h3>
            {invitations.length === 0 && <p className="ink-muted">{t('admin.noInvitations')}</p>}
            <ul className="settings__list">
              {invitations.map((i) => (
                <li key={i.id} className="settings__row">
                  <span className="settings__grow">
                    {i.email ?? t('admin.linkInvite')}
                    <span className="settings__sub">
                      {t('admin.expires', { when: date(i.expiresAt) })}
                    </span>
                  </span>
                  {i.kind === 'email' && (
                    <Button
                      variant="ghost"
                      disabled={busy || !instance?.auth.email}
                      title={!instance?.auth.email ? t('admin.smtpRequired') : undefined}
                      onClick={() =>
                        void run(async () =>
                          setCreated(await api.post<Invitation>(`/invitations/${i.id}/resend`, {})),
                        )
                      }
                    >
                      {t('admin.resend')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.delete(`/invitations/${i.id}`);
                        setCreated(null);
                      })
                    }
                  >
                    {t('admin.revoke')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
          <Dialog
            open={deactivating !== null}
            title={t('admin.deactivate')}
            onClose={() => setDeactivating(null)}
          >
            <p>{t('admin.deactivateHelp', { name: deactivating?.name })}</p>
            <DialogActions>
              <Button variant="ghost" onClick={() => setDeactivating(null)}>
                {t('project.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (deactivating) {
                    const id = deactivating.id;
                    setDeactivating(null);
                    void update(id, { active: false });
                  }
                }}
              >
                {t('admin.deactivate')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </SettingsShell>
  );
}
