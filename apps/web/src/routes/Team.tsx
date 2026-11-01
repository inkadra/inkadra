import type {
  InstanceMember,
  InstanceSettings,
  Invitation,
  InvitationResult,
} from '@inkadra/shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  Icon,
  Select,
  Switch,
  TextField,
} from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { useSession } from '../lib/session.tsx';
import { SettingsShell } from './SettingsShell.tsx';
import { trackSave } from './settings-save.ts';
import { Badge, Card, Row } from './settings-ui.tsx';

function relative(value: string, locale: string): string {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

export function Team() {
  const { user, instance, refresh } = useSession();
  const { t, i18n } = useTranslation();
  const [members, setMembers] = useState<InstanceMember[] | null>(null);
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState<InstanceMember | null>(null);
  const admin = user?.role === 'admin';
  const load = useCallback(async () => {
    const [people, pending, instanceSettings] = await Promise.all([
      api.get<{ items: InstanceMember[] }>('/instance/members'),
      api.get<{ items: Invitation[] }>('/invitations'),
      api.get<InstanceSettings>('/instance/settings'),
    ]);
    setMembers(people.items);
    setSettings(instanceSettings);
    setInvitations(pending.items.filter((i) => i.projectId === null && i.boardId === null));
  }, []);
  useEffect(() => {
    if (admin) void load().catch(() => setError(t('auth.errors.generic')));
  }, [admin, load, t]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await trackSave(
        (async () => {
          await action();
          await load();
          await refresh();
        })(),
      );
      return true;
    } catch (e) {
      setError(
        t(e instanceof RequestError && e.status === 409 ? 'admin.conflict' : 'auth.errors.generic'),
      );
      return false;
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
      (status === 'all' || (status === 'inactive') === !!m.deactivatedAt) &&
      `${m.name} ${m.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const date = (value: string) =>
    formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });

  if (!admin)
    return (
      <SettingsShell>
        <p role="alert">{t('admin.forbidden')}</p>
      </SettingsShell>
    );

  return (
    <SettingsShell
      actions={
        <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
          {t('settingsUi.members.invite')}
        </Button>
      }
    >
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      {settings && (
        <Card title={t('projectCreation.settings.title')}>
          <div className="settings-rows">
            <Row
              label={t('projectCreation.settings.label')}
              help={t('projectCreation.settings.help')}
              htmlFor="members-create-projects"
            >
              <Switch
                id="members-create-projects"
                checked={settings.membersCanCreateProjects ?? true}
                disabled={busy}
                onChange={(e) => {
                  const membersCanCreateProjects = e.target.checked;
                  // At once; a failed save reloads the stored value.
                  setSettings({ ...settings, membersCanCreateProjects });
                  void run(() =>
                    api.patch('/instance/settings', { membersCanCreateProjects }),
                  ).then((saved) => {
                    if (!saved) void load().catch(() => {});
                  });
                }}
              />
            </Row>
          </div>
        </Card>
      )}
      <div className="team-tools">
        <label className="team-search">
          <Icon name="search" size={14} />
          <input
            className="ink-input"
            type="search"
            aria-label={t('admin.search')}
            placeholder={t('admin.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select
          className="ink-input team-filter"
          aria-label={t('admin.role')}
          value={role}
          onChange={(e) => setRole(e)}
        >
          <option value="all">{t('admin.all')}</option>
          <option value="admin">{t('admin.roles.admin')}</option>
          <option value="member">{t('admin.roles.member')}</option>
        </Select>
        <Select
          className="ink-input team-filter"
          aria-label={t('admin.status')}
          value={status}
          onChange={(e) => setStatus(e)}
        >
          <option value="all">{t('settingsUi.members.allStatuses')}</option>
          <option value="active">{t('admin.active')}</option>
          <option value="inactive">{t('admin.inactive')}</option>
        </Select>
      </div>
      {members === null ? (
        !error && <p role="status">{t('admin.loading')}</p>
      ) : (
        <Card className="team-card">
          <table className="team-table">
            <caption className="ink-sr-only">
              {t('admin.membersCount', { count: members.length })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.person')}</th>
                <th scope="col">{t('admin.role')}</th>
                <th scope="col" className="team-col--create">
                  {t('projectCreation.column')}
                </th>
                <th scope="col" className="team-col--projects">
                  {t('admin.projects')}
                </th>
                <th scope="col" className="team-col--last">
                  {t('admin.lastActive')}
                </th>
                <th scope="col">
                  <span className="ink-sr-only">{t('admin.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((m) => {
                const last = m.role === 'admin' && !m.deactivatedAt && admins <= 1;
                return (
                  <tr key={m.id} className={m.deactivatedAt ? 'is-inactive' : undefined}>
                    <th scope="row">
                      <span className="team-person">
                        <Avatar name={m.name} image={m.image} size={28} />
                        <span>
                          <span className="team-person__name">
                            {m.name}
                            {m.id === user?.id && (
                              <span className="settings-muted">
                                {' '}
                                · {t('settingsUi.members.you')}
                              </span>
                            )}
                            {m.deactivatedAt && <Badge>{t('admin.inactive')}</Badge>}
                          </span>
                          <span className="settings__sub">{m.email}</span>
                        </span>
                      </span>
                    </th>
                    <td>
                      <Select
                        className="ink-input team-role"
                        aria-label={t('admin.roleFor', { name: m.name })}
                        value={m.role}
                        disabled={busy || last}
                        data-ink-tooltip={last ? t('admin.lastAdmin') : undefined}
                        onChange={(e) => void update(m.id, { role: e })}
                      >
                        <option value="admin">{t('admin.roles.admin')}</option>
                        <option value="member">{t('admin.roles.member')}</option>
                      </Select>
                    </td>
                    {/* The column title, shown on phones where the table head is hidden. */}
                    <td className="team-col--create" data-label={t('projectCreation.column')}>
                      {m.role === 'admin' ? (
                        <span className="settings-muted">{t('projectCreation.always')}</span>
                      ) : (
                        <Select
                          className="ink-input team-role"
                          aria-label={t('projectCreation.for', { name: m.name })}
                          value={
                            m.canCreateProjectsOverride === true
                              ? 'yes'
                              : m.canCreateProjectsOverride === false
                                ? 'no'
                                : 'default'
                          }
                          disabled={busy}
                          onChange={(e) =>
                            void update(m.id, {
                              canCreateProjects: e === 'default' ? null : e === 'yes',
                            })
                          }
                        >
                          <option value="default">
                            {t(
                              settings?.membersCanCreateProjects === false
                                ? 'projectCreation.defaultNo'
                                : 'projectCreation.defaultYes',
                            )}
                          </option>
                          <option value="yes">{t('projectCreation.yes')}</option>
                          <option value="no">{t('projectCreation.no')}</option>
                        </Select>
                      )}
                    </td>
                    <td className="team-col--projects">{m.projectsCount}</td>
                    <td className="team-col--last settings-muted">
                      {m.lastActiveAt ? (
                        <time dateTime={m.lastActiveAt} title={date(m.lastActiveAt)}>
                          {relative(m.lastActiveAt, i18n.language)}
                        </time>
                      ) : (
                        t('admin.never')
                      )}
                    </td>
                    <td className="team-col--actions">
                      <Button
                        variant="ghost"
                        disabled={busy || last}
                        data-ink-tooltip={last ? t('admin.lastAdmin') : undefined}
                        onClick={() =>
                          m.deactivatedAt ? void update(m.id, { active: true }) : setDeactivating(m)
                        }
                      >
                        {t(m.deactivatedAt ? 'admin.reactivate' : 'admin.deactivate')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {invitations.length > 0 && (
              <tbody className="team-pending">
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <th scope="row" colSpan={5}>
                      <span className="team-person">
                        <Badge>{t('settingsUi.members.pending')}</Badge>
                        <span>
                          <span className="team-person__name">
                            {i.email ?? t('admin.linkInvite')}
                          </span>
                          <span className="settings__sub">
                            {t('admin.expires', { when: date(i.expiresAt) })}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="team-col--actions">
                      {i.kind === 'email' && (
                        <Button
                          variant="ghost"
                          disabled={busy || !instance?.auth.email}
                          data-ink-tooltip={
                            !instance?.auth.email ? t('admin.smtpRequired') : undefined
                          }
                          onClick={() =>
                            void run(async () =>
                              setCreated(
                                await api.post<Invitation>(`/invitations/${i.id}/resend`, {}),
                              ),
                            )
                          }
                        >
                          {t('admin.resend')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run(() => api.delete(`/invitations/${i.id}`))}
                      >
                        {t('admin.revoke')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {filtered?.length === 0 && <p className="settings-card__empty">{t('admin.noMembers')}</p>}
          {invitations.length === 0 && (
            <p className="settings-card__empty settings-muted">{t('admin.noInvitations')}</p>
          )}
        </Card>
      )}
      <p className="settings-footnote">{t('admin.activityHelp')}</p>
      <InviteDialog
        open={inviting || created !== null}
        created={created}
        busy={busy}
        onInvite={(email) =>
          run(async () => {
            const result = await api.post<InvitationResult>('/invitations', {
              kind: 'email',
              email,
            });
            if (result.status !== 'invited')
              throw new Error('Unexpected instance invitation response');
            setCreated(result.invitation);
          })
        }
        onClose={() => {
          setInviting(false);
          setCreated(null);
        }}
      />
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
    </SettingsShell>
  );
}

function InviteDialog({
  open,
  created,
  busy,
  onInvite,
  onClose,
}: {
  open: boolean;
  created: Invitation | null;
  busy: boolean;
  onInvite: (email: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onInvite(email.trim())) setEmail('');
  }
  return (
    <Dialog open={open} title={t('settingsUi.members.invite')} onClose={onClose}>
      {created ? (
        <div role="status" className="settings-form">
          <p>{t(created.emailSent ? 'admin.inviteSent' : 'admin.shareInvite')}</p>
          {created.url && <TextField label={t('admin.inviteUrl')} readOnly value={created.url} />}
          <DialogActions>
            {created.url && (
              <Button
                icon="copy"
                onClick={() => navigator.clipboard?.writeText(created.url ?? '').catch(() => {})}
              >
                {t('share.copy')}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {t('settings.tokens.done')}
            </Button>
          </DialogActions>
        </div>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          <p className="settings-muted">{t('admin.inviteHelp')}</p>
          <TextField
            label={t('auth.email')}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <DialogActions>
            <Button variant="ghost" onClick={onClose}>
              {t('project.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              {t('admin.invite')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
