import type {
  BoardAccess,
  BoardAccessEntry,
  BoardDetail,
  Invitation,
  InvitationResult,
  Person,
  ProjectRole,
} from '@inkadra/shared';
import { Avatar, Button, Dialog, type DialogHandle, Icon, IconButton, Select } from '@inkadra/ui';
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { useIsPhone } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';
import { EMAIL, PeoplePicker } from '../people/PeoplePicker.tsx';
import { ExpiryLabel, ExpiryPicker } from './ExpiryPicker.tsx';
import { GuestLinks } from './GuestLinks.tsx';
import './share.css';
import { formatDateTime } from '../lib/datetime.ts';
import { linkRoleChoices, rank, roleChoices } from './share-roles.ts';

/**
 * Who can open a board and with which role: people from the project and from grants here or
 * above, invitations still waiting, and the invitation link. Editors and owners share; the
 * others see the list.
 */
export function ShareDialog({
  open,
  board,
  subBoards,
  onClose,
}: {
  open: boolean;
  board: BoardDetail;
  subBoards: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const [access, setAccess] = useState<BoardAccess | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isRoot = board.parentBoardId === null;
  const myRole = board.myRole;
  const canManage = access?.canManage ?? false;
  const choices = roleChoices(myRole);
  // Editors and owners also share with people without an account (decision 0013).
  const canShareGuests = myRole === 'owner' || myRole === 'editor';
  const [tab, setTab] = useState<ShareTab>('people');
  const tabsId = useId();
  // An invitation being typed is lost when the dialog closes.
  const [typing, setTyping] = useState(false);
  const dialog = useRef<DialogHandle>(null);
  const shownTab = canShareGuests ? tab : 'people';

  const load = useCallback(async () => {
    const a = await api.get<BoardAccess>(`/boards/${board.id}/access`);
    setAccess(a);
    if (a.canManage) {
      const list = await api.get<{ items: Invitation[] }>(`/invitations?boardId=${board.id}`);
      setInvitations(list.items);
    }
  }, [board.id]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    load().catch(() => setError(t('share.errors.load')));
  }, [open, load, t]);

  const fail = (err: unknown) => {
    if (err instanceof RequestError && err.status === 429) setError(t('share.errors.rateLimited'));
    else if (err instanceof RequestError && err.status === 403)
      setError(t('share.errors.forbidden'));
    else if (err instanceof RequestError && err.code === 'conflict') setError(err.message);
    else setError(t('share.errors.generic'));
  };
  const run = (action: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      fail(err);
    }
  };

  async function setRole(entry: BoardAccessEntry, role: ProjectRole) {
    await (isRoot
      ? api.put(`/projects/${board.projectId}/members/${entry.user.id}`, { role })
      : api.put(`/boards/${board.id}/grants/${entry.user.id}`, { role }));
  }
  // The role is sent again as it is: the end date is part of the same membership or grant.
  async function setExpiry(entry: BoardAccessEntry, expiresAt: string | null) {
    await (isRoot
      ? api.put(`/projects/${board.projectId}/members/${entry.user.id}`, {
          role: entry.role,
          expiresAt,
        })
      : api.put(`/boards/${board.id}/grants/${entry.user.id}`, { role: entry.role, expiresAt }));
  }
  async function remove(entry: BoardAccessEntry) {
    await (isRoot
      ? api.delete(`/projects/${board.projectId}/members/${entry.user.id}`)
      : api.delete(`/boards/${board.id}/grants/${entry.user.id}`));
  }

  const emailInvites = invitations.filter((i) => i.kind === 'email');
  const link = invitations.find((i) => i.kind === 'link' && i.url);

  return (
    <Dialog
      ref={dialog}
      open={open}
      dirty={typing}
      title={t('share.title', { title: board.title })}
      onClose={onClose}
    >
      <div className="share">
        <IconButton
          icon="close"
          label={t('share.close')}
          className="share__close"
          onClick={() => dialog.current?.requestClose()}
        />
        {canShareGuests && <ShareTabs id={tabsId} tab={shownTab} onTab={setTab} />}
        {shownTab === 'guests' ? (
          <div
            className="share__panel"
            role="tabpanel"
            id={`${tabsId}-guests`}
            aria-labelledby={`${tabsId}-tab-guests`}
          >
            <GuestLinks board={board} userId={user?.id} subBoards={subBoards} />
          </div>
        ) : (
          <div
            className="share__panel"
            {...(canShareGuests
              ? {
                  role: 'tabpanel',
                  id: `${tabsId}-people`,
                  'aria-labelledby': `${tabsId}-tab-people`,
                }
              : {})}
          >
            <p className="share__lead ink-muted">
              <Trans i18nKey="share.accountLead" components={{ b: <b /> }} />{' '}
              {isRoot
                ? t('share.wholeProject')
                : subBoards > 0
                  ? t('share.inherits', { count: subBoards })
                  : t('share.thisBoard')}
            </p>

            {canManage && (
              <InviteForm
                boardId={board.id}
                choices={choices}
                canEmail={instance?.auth.email ?? false}
                onDone={async (text) => {
                  await load();
                  return text;
                }}
                onError={fail}
                onTyping={setTyping}
              />
            )}

            {error && (
              <p className="share__error" role="alert">
                {error}
              </p>
            )}

            <RoleLegend />

            <h3 className="share__section" id={`${tabsId}-people-title`}>
              {t('share.people')}{' '}
              {access && (
                <span className="share__count">{access.items.length + emailInvites.length}</span>
              )}
            </h3>
            <ul className="share__box share__list" aria-labelledby={`${tabsId}-people-title`}>
              {access?.items.map((e) => {
                const me = e.user.id === user?.id;
                const own = isRoot
                  ? e.source.kind === 'project'
                  : e.source.kind === 'board' && e.source.boardId === board.id;
                // Project members (root board) are managed by owners only, as on the server.
                const editable =
                  canManage &&
                  !me &&
                  rank(e.role) <= rank(myRole) &&
                  (!isRoot || myRole === 'owner');
                return (
                  <li key={e.user.id} className="share__row">
                    <span className="share__person">
                      <Avatar image={e.user.image} name={e.user.name} size={30} />
                      <span className="share__who">
                        <span className="share__name">
                          {me ? t('share.you', { name: e.user.name }) : e.user.name}
                        </span>
                        <span className="share__sub">{sourceText(t, e, board.id, isRoot)}</span>
                        {/* A line of its own, so it is never cut off by a long address. */}
                        {e.expiresAt && (
                          <span className="share__sub">
                            <ExpiryLabel at={e.expiresAt} />
                          </span>
                        )}
                      </span>
                    </span>
                    {editable ? (
                      <RoleSelect
                        value={e.role}
                        choices={choices}
                        label={t('share.roleOf', { name: e.user.name })}
                        onChange={(role) => void run(() => setRole(e, role))()}
                      />
                    ) : (
                      <span className="share__role">{t(`roles.${e.role}`)}</span>
                    )}
                    {/* Owners never expire: a project always keeps one (decision 0041). */}
                    {editable && own && e.role !== 'owner' ? (
                      <ExpiryPicker
                        value={e.expiresAt ?? null}
                        label={t('share.expiry.of', { name: e.user.name })}
                        // Removing or extending an end date is for owners (decision 0041).
                        canExtend={myRole === 'owner'}
                        onChange={(at) => run(() => setExpiry(e, at))()}
                      />
                    ) : (
                      <span className="share__spacer" />
                    )}
                    {editable && own ? (
                      <IconButton
                        icon="close"
                        label={t('share.remove', { name: e.user.name })}
                        onClick={run(() => remove(e))}
                      />
                    ) : (
                      <span className="share__spacer" />
                    )}
                  </li>
                );
              })}
              {emailInvites.map((i) => (
                <li key={i.id} className="share__row share__row--pending">
                  <span className="share__icon-avatar" aria-hidden="true">
                    <Icon name="mail" size={14} />
                  </span>
                  <span className="share__who">
                    <span className="share__name">{i.email}</span>
                    <span className="share__sub">
                      {t('share.pending', {
                        role: i.role ? t(`roles.${i.role}`) : '',
                        when: relative(i.lastSentAt ?? i.createdAt),
                      })}
                    </span>
                  </span>
                  {i.emailSent && (
                    <Button
                      variant="ghost"
                      onClick={run(() => api.post(`/invitations/${i.id}/resend`, {}))}
                    >
                      {t('share.resend')}
                    </Button>
                  )}
                  <IconButton
                    icon="close"
                    label={t('share.cancelInvite', { email: i.email })}
                    onClick={run(() => api.delete(`/invitations/${i.id}`))}
                  />
                </li>
              ))}
            </ul>

            {canManage && (
              <LinkSection
                boardId={board.id}
                link={link ?? null}
                choices={linkRoleChoices(myRole)}
                onChange={load}
                onError={fail}
              />
            )}
            {access && !canManage && <p className="share__note ink-muted">{t('share.readOnly')}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

type ShareTab = 'people' | 'guests';
const TABS: ShareTab[] = ['people', 'guests'];

/** People with a role, or links for guests without an account. */
function ShareTabs({
  id,
  tab,
  onTab,
}: {
  id: string;
  tab: ShareTab;
  onTab: (tab: ShareTab) => void;
}) {
  const { t } = useTranslation();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')
      return;
    e.preventDefault();
    const at = TABS.indexOf(tab);
    const next =
      e.key === 'Home'
        ? TABS[0]
        : e.key === 'End'
          ? TABS[TABS.length - 1]
          : TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    onTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return (
    <div
      className="share__tabs"
      role="tablist"
      aria-label={t('share.tabs')}
      onKeyDown={onKeyDown}
      data-tour="share-tabs"
    >
      {TABS.map((value) => (
        <button
          key={value}
          id={`${id}-tab-${value}`}
          type="button"
          role="tab"
          className="share__tab"
          aria-selected={tab === value}
          aria-controls={`${id}-${value}`}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onTab(value)}
        >
          {t(`share.tab.${value}`)}
        </button>
      ))}
    </div>
  );
}

function sourceText(
  t: (key: string, opts?: Record<string, unknown>) => string,
  e: BoardAccessEntry,
  boardId: string,
  isRoot: boolean,
): string {
  const email = e.user.email ? `${e.user.email} · ` : '';
  if (e.source.kind === 'project')
    return `${email}${isRoot ? t('share.member') : t('share.fromProject')}`;
  if (e.source.boardId !== boardId)
    return `${email}${t('share.inherited', { board: e.source.boardTitle })}`;
  return e.projectRole
    ? `${email}${t('share.custom', { role: t(`roles.${e.projectRole}`) })}`
    : `${email}${t('share.onlyHere')}`;
}

function relative(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', {
    numeric: 'auto',
  });
  return rtf.format(-days, 'day');
}

function RoleSelect({
  value,
  choices,
  label,
  describedBy,
  onChange,
}: {
  value: ProjectRole;
  choices: ProjectRole[];
  label: string;
  describedBy?: string;
  onChange: (role: ProjectRole) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      className="share__select"
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      onChange={(e) => onChange(e as ProjectRole)}
    >
      {choices.map((r) => (
        <option key={r} value={r}>
          {t(`roles.${r}`)}
        </option>
      ))}
    </Select>
  );
}

/**
 * What each role can do, folded away: only an explanation, nothing in it to choose. Viewer to
 * editor follow CAPABILITY_ROLE (decision 0011); what only owners do comes from the project
 * routes (members, archive, delete).
 */
function RoleLegend() {
  const { t } = useTranslation();
  return (
    <details className="share__legend" data-tour="share-roles">
      <summary>
        <Icon name="chevronRight" size={14} />
        {t('share.legend.title')}
      </summary>
      <dl>
        {roleChoices('owner').map((role) => (
          <Fragment key={role}>
            <dt>{t(`roles.${role}`)}</dt>
            <dd>{t(`share.legend.${role}`)}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

/** Invite by email, or add someone who already has an account by name. */
function InviteForm({
  boardId,
  choices,
  canEmail,
  onDone,
  onError,
  onTyping,
}: {
  boardId: string;
  choices: ProjectRole[];
  canEmail: boolean;
  onDone: (text: string) => Promise<string>;
  onError: (err: unknown) => void;
  /** Whether a name or address is typed and not yet invited. */
  onTyping: (typing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<ProjectRole>(
    choices.includes('commenter') ? 'commenter' : 'viewer',
  );
  const [found, setFound] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [copyUrl, setCopyUrl] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const ids = useId();
  // The full hint does not fit a phone: the short label says enough there.
  const phone = useIsPhone();
  const typing = query.trim() !== '';
  useEffect(() => {
    onTyping(typing);
  }, [typing, onTyping]);
  useEffect(() => () => onTyping(false), [onTyping]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const typed = query.trim();
    const email = EMAIL.test(typed)
      ? typed
      : found.find((p) => p.name.toLowerCase() === typed.toLowerCase())?.email;
    if (!email) {
      setStatus(t('share.errors.address'));
      return;
    }
    setBusy(true);
    setStatus(null);
    setCopyUrl(null);
    try {
      const res = await api.post<InvitationResult>('/invitations', {
        kind: 'email',
        email,
        boardId,
        role,
        ...(until && role !== 'owner' ? { accessExpiresAt: until } : {}),
      });
      setQuery('');
      setUntil(null);
      setFound([]);
      if (res.status === 'added') {
        setStatus(await onDone(t('share.added', { name: res.entry.user.name })));
      } else if (res.invitation.emailSent) {
        setStatus(await onDone(t('share.sent', { email })));
      } else {
        // No email on this instance: the person gets the link some other way.
        setCopyUrl(res.invitation.url);
        setStatus(await onDone(t('share.noEmail', { email })));
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="share__invite" onSubmit={submit} data-tour="share-invite">
      <label className="share__label" htmlFor={`${ids}-who`}>
        {t('share.invite')}
      </label>
      <div className="share__field">
        <PeoplePicker
          id={`${ids}-who`}
          className="share__picker"
          inputClassName="share__input"
          placeholder={
            phone
              ? t('share.inviteLabel')
              : canEmail
                ? t('share.invitePlaceholder')
                : t('share.invitePlaceholderNoEmail')
          }
          aria-label={t('share.inviteField')}
          value={query}
          onChange={setQuery}
          onPick={(p) => setQuery(p.email ?? p.name)}
          onResults={setFound}
        />
        <RoleSelect
          value={role}
          choices={choices}
          label={t('share.inviteRole')}
          describedBy={`${ids}-role`}
          onChange={setRole}
        />
        {role !== 'owner' && (
          <>
            {until && <ExpiryLabel at={until} />}
            <ExpiryPicker value={until} label={t('share.expiry.invite')} onChange={setUntil} />
          </>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={busy || query.trim() === ''}>
        {t('share.invite')}
      </Button>
      <p className="share__hint" id={`${ids}-role`}>
        <b>{t(`roles.${role}`)}:</b> {t(`share.roleHint.${role}`)}
      </p>
      {status && (
        <p className="share__status" role="status">
          {status}
          {copyUrl && <CopyButton text={copyUrl} />}
        </p>
      )}
    </form>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      icon="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? t('share.copied') : t('share.copy')}
    </Button>
  );
}

/** One invitation link per board: anyone with it joins with the chosen role until it expires. */
function LinkSection({
  boardId,
  link,
  choices,
  onChange,
  onError,
}: {
  boardId: string;
  link: Invitation | null;
  choices: ProjectRole[];
  onChange: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [days, setDays] = useState(7);

  const act = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      await onChange();
    } catch (err) {
      onError(err);
    }
  };
  const create = () =>
    api.post('/invitations', { kind: 'link', boardId, role, expiresInDays: days });

  return (
    <section aria-labelledby={`${boardId}-link`} data-tour="share-link">
      <h3 className="share__section" id={`${boardId}-link`}>
        {t('share.link.title')}
      </h3>
      <div className="share__box share__link">
        <div className="share__link-row">
          <span className="share__icon-avatar" aria-hidden="true">
            <Icon name="link" size={14} />
          </span>
          <span className="share__who">
            <span className="share__name">{t('share.link.name')}</span>
            <span className="share__sub">
              {link
                ? t('share.link.active', {
                    role: link.role ? t(`roles.${link.role}`) : '',
                    date: formatDateTime(link.expiresAt, {
                      day: 'numeric',
                      month: 'long',
                    }),
                    count: link.uses,
                  })
                : t('share.link.body')}
            </span>
          </span>
          {link?.url ? (
            <>
              <CopyButton text={link.url} />
              <Button variant="ghost" onClick={act(() => api.delete(`/invitations/${link.id}`))}>
                {t('share.link.revoke')}
              </Button>
            </>
          ) : (
            <>
              <RoleSelect
                value={role}
                choices={choices}
                label={t('share.link.role')}
                onChange={setRole}
              />
              <Select
                className="share__select"
                aria-label={t('share.link.expires')}
                value={days}
                onChange={(e) => setDays(Number(e))}
              >
                {[1, 7, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {t('share.link.days', { count: d })}
                  </option>
                ))}
              </Select>
              <Button icon="link" aria-label={t('share.link.create')} onClick={act(create)}>
                {t('share.link.createShort')}
              </Button>
            </>
          )}
        </div>
        {/* Whole, to copy by hand where the clipboard is not allowed (plain http). */}
        {link?.url && (
          <input
            className="ink-input share__url"
            readOnly
            data-feedback-secret
            value={link.url}
            aria-label={t('share.link.title')}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
    </section>
  );
}
