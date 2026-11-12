import type {
  InstanceMember,
  InstanceSettings,
  Invitation,
  InvitationResult,
  StorageLimits,
} from '@inkadra/shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  Icon,
  IconButton,
  Radio,
  Select,
  type SelectOption,
  TextField,
} from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { useSession } from '../lib/session.tsx';
import { useMenu } from './ProjectAppearance.tsx';
import { SettingsShell } from './SettingsShell.tsx';
import { formatStorage } from './StorageCharts.tsx';
import { SizeInput } from './StorageLimitsSettings.tsx';
import { LargestFilesDialog, SpaceMeter, spaceTone } from './StorageSpace.tsx';
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

/** The «Creates projects» value of a member: the instance default, or their own yes or no. */
export function projectCreationValue(override: boolean | null | undefined) {
  return override === true ? 'yes' : override === false ? 'no' : 'default';
}

/**
 * The «Creates projects» choices: the column names the setting, so a value is one short word;
 * the default also shows the instance rule (· yes), hidden in the menu, where a line explains it.
 */
export function projectCreationOptions(
  t: (key: string) => string,
  instanceAllows: boolean,
): SelectOption[] {
  return [
    {
      value: 'default',
      label: (
        <>
          {t('projectCreation.default')}
          <span className="team-create__current">
            {' · '}
            {t(instanceAllows ? 'projectCreation.currentYes' : 'projectCreation.currentNo')}
          </span>
        </>
      ),
      description: t(
        instanceAllows ? 'projectCreation.defaultHintYes' : 'projectCreation.defaultHintNo',
      ),
    },
    { value: 'yes', label: t('projectCreation.yes'), description: t('projectCreation.yesHint') },
    { value: 'no', label: t('projectCreation.no'), description: t('projectCreation.noHint') },
  ];
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
  const [spaceOf, setSpaceOf] = useState<InstanceMember | null>(null);
  const [filesOf, setFilesOf] = useState<InstanceMember | null>(null);
  const [limits, setLimits] = useState<StorageLimits | null>(null);
  const admin = user?.role === 'admin';
  const load = useCallback(async () => {
    const [people, pending, instanceSettings, storageLimits] = await Promise.all([
      api.get<{ items: InstanceMember[] }>('/instance/members'),
      api.get<{ items: Invitation[] }>('/invitations'),
      api.get<InstanceSettings>('/instance/settings'),
      // Older pages work without it: the column then shows the size alone.
      api.get<StorageLimits>('/instance/storage-limits').catch(() => null),
    ]);
    setMembers(people.items);
    setSettings(instanceSettings);
    setLimits(storageLimits);
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
        <Button
          variant="primary"
          icon="plus"
          data-tour="users-invite"
          onClick={() => setInviting(true)}
        >
          {t('settingsUi.members.invite')}
        </Button>
      }
    >
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
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
        <Card
          className="team-card"
          tour="users"
          title={t('admin.membersCount', { count: members.length })}
        >
          {filtered !== undefined && filtered.length > 0 && (
            // Aligned columns with a header (decision 0124); on a phone each row wraps under
            // the name and the header is read only by screen readers.
            <div
              role="table"
              className="team-table"
              aria-label={t('admin.membersCount', { count: members.length })}
            >
              <div role="row" className="team-head">
                <span role="columnheader">{t('settingsUi.members.person')}</span>
                <span role="columnheader">{t('settingsUi.members.space')}</span>
                <span role="columnheader">{t('admin.role')}</span>
                <span role="columnheader">{t('projectCreation.column')}</span>
                <span role="columnheader">
                  <span className="ink-sr-only">{t('settingsUi.members.actions')}</span>
                </span>
              </div>
              {filtered.map((m) => {
                const last = m.role === 'admin' && !m.deactivatedAt && admins <= 1;
                const meta = [
                  m.email,
                  t('settingsUi.members.projects', { count: m.projectsCount }),
                  m.lastActiveAt ? relative(m.lastActiveAt, i18n.language) : t('admin.never'),
                ].join(' · ');
                return (
                  <div
                    role="row"
                    key={m.id}
                    className={
                      m.deactivatedAt ? 'settings-row team-member is-inactive' : 'settings-row team-member'
                    }
                  >
                    <div role="cell" className="team-col--who">
                      <Avatar name={m.name} image={m.image} size={32} />
                      <span className="settings-row__text">
                        <span className="settings-row__label">
                          <span className="team-member__name" title={m.name}>
                            {m.name}
                          </span>
                          {m.id === user?.id && (
                            <span className="settings-muted">· {t('settingsUi.members.you')}</span>
                          )}
                          {m.deactivatedAt && <Badge>{t('admin.inactive')}</Badge>}
                        </span>
                        <span className="settings-row__help team-member__meta" title={meta}>
                          {m.email} · {t('settingsUi.members.projects', { count: m.projectsCount })}{' '}
                          ·{' '}
                          {m.lastActiveAt ? (
                            <time dateTime={m.lastActiveAt} title={date(m.lastActiveAt)}>
                              {relative(m.lastActiveAt, i18n.language)}
                            </time>
                          ) : (
                            t('admin.never')
                          )}
                        </span>
                      </span>
                    </div>
                    <div role="cell" className="team-col--space">
                      <MemberSpace member={m} warnPercent={limits?.warnPercent ?? 80} />
                    </div>
                    <div role="cell" className="team-col--role">
                      <Select
                        variant="quiet"
                        className="team-role"
                        aria-label={t('admin.roleFor', { name: m.name })}
                        value={m.role}
                        disabled={busy || last}
                        data-ink-tooltip={last ? t('admin.lastAdmin') : undefined}
                        onChange={(e) => void update(m.id, { role: e })}
                      >
                        <option value="admin">{t('admin.roles.admin')}</option>
                        <option value="member">{t('admin.roles.member')}</option>
                      </Select>
                    </div>
                    <div role="cell" className="team-col--create">
                      {m.role === 'admin' ? (
                        <span className="settings-muted team-create">
                          <span className="ink-sr-only">{t('projectCreation.column')}: </span>
                          {t('projectCreation.always')}
                        </span>
                      ) : (
                        <Select
                          variant="quiet"
                          className="team-role team-create"
                          aria-label={t('projectCreation.for', { name: m.name })}
                          value={projectCreationValue(m.canCreateProjectsOverride)}
                          options={projectCreationOptions(
                            t,
                            settings?.membersCanCreateProjects !== false,
                          )}
                          disabled={busy}
                          onChange={(e) =>
                            void update(m.id, {
                              canCreateProjects: e === 'default' ? null : e === 'yes',
                            })
                          }
                        />
                      )}
                    </div>
                    <div role="cell" className="team-col--actions">
                      <MemberMenu
                        member={m}
                        disabled={busy}
                        last={last}
                        onSpace={() => setSpaceOf(m)}
                        onFiles={() => setFilesOf(m)}
                        onActive={() =>
                          m.deactivatedAt ? void update(m.id, { active: true }) : setDeactivating(m)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {filtered?.length === 0 && <p className="settings-card__empty">{t('admin.noMembers')}</p>}
        </Card>
      )}
      {members !== null && (
        <Card title={t('settingsUi.members.invitations')}>
          {invitations.length === 0 ? (
            <p className="settings-card__empty settings-muted">{t('admin.noInvitations')}</p>
          ) : (
            invitations.map((i) => (
              <Row
                key={i.id}
                className="team-pending"
                icon={i.kind === 'email' ? 'mail' : 'link'}
                label={i.email ?? t('admin.linkInvite')}
                help={t('admin.expires', { when: date(i.expiresAt) })}
              >
                {i.kind === 'email' && (
                  <Button
                    variant="ghost"
                    disabled={busy || !instance?.auth.email}
                    data-ink-tooltip={!instance?.auth.email ? t('admin.smtpRequired') : undefined}
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
                  onClick={() => void run(() => api.delete(`/invitations/${i.id}`))}
                >
                  {t('admin.revoke')}
                </Button>
              </Row>
            ))
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
      {spaceOf && (
        <PersonSpaceDialog
          member={spaceOf}
          limits={limits}
          busy={busy}
          onSave={async (storageLimit) => {
            if (await update(spaceOf.id, { storageLimit })) setSpaceOf(null);
          }}
          onClose={() => setSpaceOf(null)}
        />
      )}
      <LargestFilesDialog
        open={filesOf !== null}
        path={`/instance/members/${filesOf?.id ?? ''}/files`}
        title={t('storageSpace.filesOf', { name: filesOf?.name ?? '' })}
        onClose={() => setFilesOf(null)}
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

/** The Spazio column: what a person uses, over their limit and with a short bar if they have one. */
function MemberSpace({ member, warnPercent }: { member: InstanceMember; warnPercent: number }) {
  const { t, i18n } = useTranslation();
  if (member.storageBytes === undefined) return null;
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const limit = member.storageLimit ?? null;
  const own = (member.storageLimitOverride ?? 0) > 0;
  return (
    <span className="space-mini">
      <span>
        {size(member.storageBytes)}
        {/* Without a limit the size stands alone: no «/ unlimited» repeated on every row. */}
        {limit !== null && (
          <>
            {' '}
            <em>/ {own ? t('storageSpace.own', { size: size(limit) }) : size(limit)}</em>
          </>
        )}
      </span>
      {limit !== null && (
        <SpaceMeter
          originals={member.storageBytes}
          limit={limit}
          tone={spaceTone(member.storageBytes, limit, warnPercent)}
          label={member.name}
          small
        />
      )}
    </span>
  );
}

/** The ⋯ menu of a member: space, files, then deactivation set apart. */
function MemberMenu({
  member,
  disabled,
  last,
  onSpace,
  onFiles,
  onActive,
}: {
  member: InstanceMember;
  disabled: boolean;
  last: boolean;
  onSpace: () => void;
  onFiles: () => void;
  onActive: () => void;
}) {
  const { t } = useTranslation();
  const label = t('storageSpace.actionsFor', { name: member.name });
  const menu = useMenu(label, [
    { label: t('storageSpace.changeLimit'), action: onSpace },
    { label: t('storageSpace.seeFiles'), action: onFiles },
    {
      label: t(member.deactivatedAt ? 'admin.reactivate' : 'admin.deactivate'),
      action: onActive,
      disabled: last,
      danger: true,
    },
  ]);
  return (
    <>
      <IconButton
        icon="more"
        label={label}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        disabled={disabled}
        onClick={(e) => menu.open(e.currentTarget, e.currentTarget)}
      />
      {menu.layer}
    </>
  );
}

type Choice = 'default' | 'own' | 'none';

/** "Spazio di …": as everyone, a limit of their own, or none. */
function PersonSpaceDialog({
  member,
  limits,
  busy,
  onSave,
  onClose,
}: {
  member: InstanceMember;
  limits: StorageLimits | null;
  busy: boolean;
  onSave: (storageLimit: number | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const name = useId();
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const override = member.storageLimitOverride ?? null;
  const [choice, setChoice] = useState<Choice>(
    override === null ? 'default' : override === 0 ? 'none' : 'own',
  );
  const perUser = limits?.perUser ?? null;
  const [own, setOwn] = useState(override && override > 0 ? override : (perUser ?? 5e9));
  // A limit of the environment can only be lowered for one person.
  const ceiling = limits?.locked.perUser ? perUser : null;
  const used = member.storageBytes ?? 0;
  const limit = member.storageLimit ?? null;
  const choices: Array<{ value: Choice; label: string; disabled?: boolean }> = [
    {
      value: 'default',
      label: t('storageSpace.asEveryone', {
        size: perUser === null ? t('storageSpace.unlimitedShort') : size(perUser),
      }),
    },
    { value: 'own', label: t('storageSpace.ownLimit') },
    { value: 'none', label: t('storageSpace.unlimited'), disabled: ceiling !== null },
  ];
  return (
    <Dialog open title={t('storageSpace.spaceOf', { name: member.name })} onClose={onClose}>
      <p className="settings-muted">{t('storageSpace.uses', { size: size(used) })}</p>
      {limit !== null && (
        <SpaceMeter
          originals={used}
          limit={limit}
          tone={spaceTone(used, limit, limits?.warnPercent ?? 80)}
          label={t('storageSpace.spaceOf', { name: member.name })}
        />
      )}
      <fieldset className="space-choice">
        <legend className="ink-sr-only">{t('storageSpace.changeLimit')}</legend>
        {choices.map((c) => (
          <label key={c.value}>
            <Radio
              name={name}
              value={c.value}
              checked={choice === c.value}
              disabled={c.disabled}
              onChange={() => setChoice(c.value)}
            />
            {c.label}
            {c.value === 'own' && (
              <span className="space-limit">
                <SizeInput
                  value={own}
                  label={t('storageSpace.ownLimit')}
                  readOnly={choice !== 'own'}
                  onCommit={setOwn}
                />
              </span>
            )}
          </label>
        ))}
      </fieldset>
      {ceiling !== null && choice === 'own' && own > ceiling && (
        <p role="alert" className="settings-error">
          {t('storageSpace.ceiling', { size: size(ceiling) })}
        </p>
      )}
      <p className="settings-muted">{t('storageSpace.lowerHelp')}</p>
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          {t('project.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={busy || (ceiling !== null && choice === 'own' && own > ceiling)}
          onClick={() => void onSave(choice === 'default' ? null : choice === 'none' ? 0 : own)}
        >
          {t('storageSpace.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
