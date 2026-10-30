import type {
  BoardAccess,
  BoardAccessEntry,
  BoardDetail,
  Invitation,
  InvitationResult,
  Person,
  ProjectRole,
} from '@inkadra/shared';
import { Avatar, Button, Dialog, Icon, IconButton } from '@inkadra/ui';
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { ExpiryLabel, ExpiryPicker } from './ExpiryPicker.tsx';
import { GuestLinks } from './GuestLinks.tsx';
import { PermissionsMatrix } from './PermissionsMatrix.tsx';
import './share.css';
import { linkRoleChoices, rank, roleChoices } from './share-roles.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
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
    <Dialog open={open} title={t('share.title', { title: board.title })} onClose={onClose}>
      <div className="share">
        <IconButton
          icon="close"
          label={t('share.close')}
          className="share__close"
          onClick={onClose}
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
              />
            )}

            {error && (
              <p className="share__error" role="alert">
                {error}
              </p>
            )}

            <p id={`${tabsId}-person-hint`} className="share__sr">
              {t('share.highlightHint')}
            </p>
            <ul className="share__list" aria-label={t('share.people')}>
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
                  <li
                    key={e.user.id}
                    className="share__row"
                    onFocus={() => setSelectedUserId(e.user.id)}
                  >
                    <button
                      type="button"
                      className="share__person"
                      aria-pressed={selectedUserId === e.user.id}
                      aria-describedby={`${tabsId}-person-hint`}
                      onClick={() => setSelectedUserId(e.user.id)}
                    >
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
                    </button>
                    {editable ? (
                      <RoleSelect
                        value={e.role}
                        choices={choices}
                        label={t('share.roleOf', { name: e.user.name })}
                        onChange={(role) => {
                          setSelectedUserId(e.user.id);
                          void run(() => setRole(e, role))();
                        }}
                      />
                    ) : (
                      <span className="share__role">{t(`roles.${e.role}`)}</span>
                    )}
                    {/* Owners never expire: a project always keeps one (decision 0041). */}
                    {editable && own && e.role !== 'owner' ? (
                      <ExpiryPicker
                        value={e.expiresAt ?? null}
                        label={t('share.expiry.of', { name: e.user.name })}
                        onChange={(at) => {
                          setSelectedUserId(e.user.id);
                          return run(() => setExpiry(e, at))();
                        }}
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
                  <span className="share__pending-avatar" aria-hidden="true">
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
            <PermissionsMatrix
              selectedRole={
                access?.items.find((entry) => entry.user.id === selectedUserId)?.role ?? myRole
              }
            />

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
    <div className="share__tabs" role="tablist" aria-label={t('share.tabs')} onKeyDown={onKeyDown}>
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
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'it', {
    numeric: 'auto',
  });
  return rtf.format(-days, 'day');
}

function RoleSelect({
  value,
  choices,
  label,
  onChange,
}: {
  value: ProjectRole;
  choices: ProjectRole[];
  label: string;
  onChange: (role: ProjectRole) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      className="share__select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as ProjectRole)}
    >
      {choices.map((r) => (
        <option key={r} value={r}>
          {t(`roles.${r}`)}
        </option>
      ))}
    </select>
  );
}

/** Invite by email, or add someone who already has an account by name. */
function InviteForm({
  boardId,
  choices,
  canEmail,
  onDone,
  onError,
}: {
  boardId: string;
  choices: ProjectRole[];
  canEmail: boolean;
  onDone: (text: string) => Promise<string>;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<ProjectRole>(
    choices.includes('commenter') ? 'commenter' : 'viewer',
  );
  const [found, setFound] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [copyUrl, setCopyUrl] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    // Results of the previous text must never be picked for the new one.
    setFound([]);
    if (q.length < 2 || EMAIL.test(q)) return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .get<{ items: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => current && setFound(r.items))
        .catch(() => current && setFound([]));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

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
    <form className="share__invite" onSubmit={submit}>
      <div className="share__field">
        <input
          className="share__input"
          type="text"
          inputMode="email"
          autoComplete="off"
          list={listId}
          placeholder={
            canEmail ? t('share.invitePlaceholder') : t('share.invitePlaceholderNoEmail')
          }
          aria-label={t('share.inviteLabel')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <datalist id={listId}>
          {found.map((p) => (
            <option key={p.id} value={p.email ?? p.name}>
              {p.name}
            </option>
          ))}
        </datalist>
        <RoleSelect
          value={role}
          choices={choices}
          label={t('share.inviteRole')}
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
      {status && (
        <p className="share__status" role="status">
          {status}
          {copyUrl && <CopyButton text={copyUrl} />}
        </p>
      )}
    </form>
  );
}

function CopyButton({ text, primary }: { text: string; primary?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={primary ? 'primary' : 'ghost'}
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
  const { t, i18n } = useTranslation();
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
    <section className="share__link" aria-labelledby={`${boardId}-link`}>
      <div className="share__link-head">
        <span className="share__who">
          <b id={`${boardId}-link`}>{t('share.link.title')}</b>
          <span className="share__sub">
            {link
              ? t('share.link.active', {
                  role: link.role ? t(`roles.${link.role}`) : '',
                  date: new Date(link.expiresAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                  }),
                  count: link.uses,
                })
              : t('share.link.body')}
          </span>
        </span>
      </div>
      {link?.url ? (
        <div className="share__link-row">
          <input
            className="share__input share__url"
            readOnly
            value={link.url}
            aria-label={t('share.link.title')}
          />
          <CopyButton text={link.url} primary />
          <Button variant="ghost" onClick={act(() => api.delete(`/invitations/${link.id}`))}>
            {t('share.link.revoke')}
          </Button>
        </div>
      ) : (
        <div className="share__link-row">
          <RoleSelect
            value={role}
            choices={choices}
            label={t('share.link.role')}
            onChange={setRole}
          />
          <select
            className="share__select"
            aria-label={t('share.link.expires')}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {t('share.link.days', { count: d })}
              </option>
            ))}
          </select>
          <Button icon="link" onClick={act(create)}>
            {t('share.link.create')}
          </Button>
        </div>
      )}
    </section>
  );
}
