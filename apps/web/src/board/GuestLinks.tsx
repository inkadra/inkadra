import type { BoardDetail, ShareLink, ShareLinkPicks } from '@inkadra/shared';
import {
  Button,
  Icon,
  IconButton,
  RadioGroup,
  Segmented,
  Select,
  Switch,
  TextField,
} from '@inkadra/ui';
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { useModules } from '../lib/modules.ts';
import { useIsPhone } from '../lib/phone.ts';
import { relativeTime } from '../notifications/Notifications.tsx';
import { useMenu } from '../routes/ProjectAppearance.tsx';
import { whileVisible } from './film/schedule.ts';
import {
  canChangeScope,
  createOf,
  draftOf,
  EXPIRY_DAYS,
  GUEST_ROLES,
  type LinkDraft,
  linkSummary,
  MIN_PASSWORD,
  namesText,
  newDraft,
  patchOf,
  pickedFileNames,
  pickedWithoutName,
  picksCsv,
  statusOf,
  willHavePassword,
} from './guest-links.ts';
import { refreshBoardCounts } from './live-counts.ts';
import './guest-links.css';
import { formatDateTime } from '../lib/datetime.ts';

type T = (key: string, opts?: Record<string, unknown>) => string;

function errorText(t: T, err: unknown): string {
  if (err instanceof RequestError) {
    if (err.status === 429) return t('guestLinks.errors.rateLimited');
    if (err.status === 403) return t('guestLinks.errors.forbidden');
    if (err.status === 409) return t('guestLinks.errors.revoked');
    if (err.status === 400) return t('guestLinks.errors.invalid');
  }
  return t('guestLinks.errors.generic');
}

function formatDate(iso: string, locale: string, time = false): string {
  return formatDateTime(
    iso,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    },
    undefined,
    locale,
  );
}

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Links for people without an account (decision 0013): editors and owners create them, list
 * them with their state, copy, change and revoke them, and read the proofing results.
 */
export function GuestLinks({
  board,
  userId,
  subBoards,
}: {
  board: BoardDetail;
  userId: string | undefined;
  subBoards: number;
}) {
  const { t } = useTranslation();
  // Client review off (decision 0121): no new link; the ones that exist stay listed.
  const { offers } = useModules();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ShareLink | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const backFrom = useRef<string | null>(null);

  const load = useCallback(async () => {
    const list = await api.get<{ items: ShareLink[] }>(`/boards/${board.id}/share-links`);
    setLinks(list.items);
  }, [board.id]);

  useEffect(() => {
    load().catch((err) => setError(errorText(t, err)));
  }, [load, t]);
  // A link opened while the dialog is open stops saying "Not opened yet".
  useEffect(() => whileVisible(() => void load().catch(() => {})), [load]);

  useEffect(() => {
    if (results || !backFrom.current) return;
    document.getElementById(`guest-link-${backFrom.current}`)?.focus();
    backFrom.current = null;
  }, [results]);

  if (results) {
    return (
      <PicksView
        link={results}
        onBack={() => {
          backFrom.current = results.id;
          setResults(null);
        }}
      />
    );
  }

  return (
    <div className="guest-links">
      <p className="share__lead ink-muted">
        <Trans i18nKey="guestLinks.lead" components={{ b: <b /> }} />
      </p>
      {offers('menus', 'reviewLink') && (
      <CreateForm
        boardId={board.id}
        subBoards={subBoards}
        onCreated={async (link) => {
          setFresh(link.id);
          setError(null);
          await load();
          // A review link shows in the sidebar's Review row at once.
          refreshBoardCounts();
        }}
      />
      )}
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      {links && links.length === 0 && (
        <p className="share__note ink-muted">{t('guestLinks.none')}</p>
      )}
      {links && links.length > 0 && (
        <section aria-labelledby={`${board.id}-guest-links`}>
          <h3 className="share__section" id={`${board.id}-guest-links`}>
            {t('guestLinks.active')}{' '}
            <span className="share__count">
              {links.filter((link) => statusOf(link) === 'active').length}
            </span>
          </h3>
          <ul className="share__box guest-links__list" aria-label={t('guestLinks.list')}>
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                fresh={fresh === link.id}
                scope={canChangeScope(link, userId, board.myRole)}
                subBoards={subBoards}
                onChanged={async () => {
                  setError(null);
                  await load();
                  refreshBoardCounts();
                }}
                onError={(err) => setError(errorText(t, err))}
                onResults={() => setResults(link)}
              />
            ))}
          </ul>
          {/* The rule the lead used to carry: a link lives on its creator's editor role. */}
          <p className="guest-links__hint guest-links__valid">{t('guestLinks.validWhile')}</p>
        </section>
      )}
    </div>
  );
}

/** One on/off option of a link: a switch, its name and one line on what it does. */
function Option({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="guest-links__option">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="guest-links__option-text">
        <label htmlFor={id}>{label}</label>
        <span id={`${id}-hint`} className="guest-links__hint">
          {hint}
        </span>
      </span>
    </div>
  );
}

/**
 * The fields of a link, the same to create and to change one: who it is for, the expiry, what
 * whoever opens it can do, and its options. `link` is the link being changed, if any.
 */
function LinkFields({
  draft,
  set,
  link,
  scope,
  subBoards,
}: {
  draft: LinkDraft;
  set: (patch: Partial<LinkDraft>) => void;
  link?: ShareLink;
  scope: boolean;
  subBoards: number;
}) {
  const { t } = useTranslation();
  const expiryId = useId();
  const disabled = !scope;
  const password = willHavePassword(draft, link);
  const RoleChoice = useIsPhone() ? RadioGroup : Segmented;
  return (
    <>
      <div className="guest-links__pair">
        <TextField
          label={t('guestLinks.label')}
          value={draft.label}
          maxLength={80}
          placeholder={t('guestLinks.labelPlaceholder')}
          onChange={(e) => set({ label: e.target.value })}
        />
        <div className="ink-field">
          <label htmlFor={expiryId} className="ink-field__label">
            {t('guestLinks.expiry')}
          </label>
          <Select
            id={expiryId}
            disabled={disabled}
            value={String(draft.expiry)}
            onChange={(v) => set({ expiry: v === 'keep' || v === 'none' ? v : Number(v) })}
          >
            {link && <option value="keep">{t('guestLinks.keepExpiry')}</option>}
            <option value="none">{t('guestLinks.never')}</option>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {t(link ? 'guestLinks.fromNow' : 'share.link.days', { count: d })}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {/* The three segments do not fit a phone in every language (German): a list there. */}
      <RoleChoice
        className="guest-links__role"
        label={t('guestLinks.role')}
        hideLabel={false}
        value={draft.role}
        disabled={disabled}
        onChange={(role) => set({ role })}
        hint={t(`guestLinks.roleHelp.${draft.role}`)}
        options={GUEST_ROLES.map((r) => ({ value: r, label: t(`guestLinks.roles.${r}`) }))}
      />
      {/* A legend would cut the box's top border: the border is on the inner grid. */}
      <fieldset className="guest-links__set">
        <legend className="ink-sr-only">{t('guestLinks.options')}</legend>
        <div className="guest-links__options">
          <Option
            label={t('guestLinks.proofing')}
            hint={t('guestLinks.proofingHint')}
            checked={draft.proofing}
            disabled={disabled}
            onChange={(proofing) => set({ proofing })}
          />
          <Option
            label={t('guestLinks.download')}
            hint={t('guestLinks.downloadHint')}
            checked={draft.allowDownload}
            disabled={disabled}
            onChange={(allowDownload) => set({ allowDownload })}
          />
          {subBoards > 0 && (
            <Option
              label={t('guestLinks.subBoards')}
              hint={t('guestLinks.subBoardsHint', { count: subBoards })}
              checked={draft.includeSubBoards}
              disabled={disabled}
              onChange={(includeSubBoards) => set({ includeSubBoards })}
            />
          )}
          <Option
            label={t('guestLinks.password')}
            hint={t('guestLinks.passwordHint', { min: MIN_PASSWORD })}
            checked={password}
            disabled={disabled}
            onChange={(on) =>
              set({
                password: {
                  // A link that has one keeps it when switched back on, and loses it when off.
                  mode: on
                    ? link?.hasPassword
                      ? 'keep'
                      : 'set'
                    : link?.hasPassword
                      ? 'remove'
                      : 'keep',
                  value: '',
                },
              })
            }
          />
          {password && (
            <div className="guest-links__password">
              {draft.password.mode === 'set' ? (
                <>
                  <TextField
                    label={t(
                      link?.hasPassword ? 'guestLinks.newPassword' : 'guestLinks.passwordField',
                    )}
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD}
                    maxLength={128}
                    disabled={disabled}
                    value={draft.password.value}
                    onChange={(e) => set({ password: { mode: 'set', value: e.target.value } })}
                  />
                  {link?.hasPassword && (
                    <p className="guest-links__hint">{t('guestLinks.passwordChangeHint')}</p>
                  )}
                </>
              ) : (
                <p className="guest-links__kept">
                  <span>{t('guestLinks.passwordKept')}</span>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => set({ password: { mode: 'set', value: '' } })}
                  >
                    {t('guestLinks.passwordChange')}
                  </Button>
                </p>
              )}
            </div>
          )}
        </div>
      </fieldset>
    </>
  );
}

/** The summary of the draft, then cancel and the form's own button. */
function FormFooter({
  draft,
  link,
  subBoards,
  busy,
  submit,
  onCancel,
}: {
  draft: LinkDraft;
  link?: ShareLink;
  subBoards: number;
  busy: boolean;
  submit: ReactNode;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const parts = linkSummary(t, draft, {
    subBoards,
    link,
    date: (iso) => formatDate(iso, i18n.language),
  });
  return (
    <div className="guest-links__footer">
      <p className="guest-links__summary">
        {parts.map((part, i) =>
          part.strong ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence, in order
            <b key={i}>{part.text}</b>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence, in order
            <Fragment key={i}>{part.text}</Fragment>
          ),
        )}
      </p>
      <div className="guest-links__actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('guestLinks.cancel')}
        </Button>
        {submit}
      </div>
    </div>
  );
}

function CreateForm({
  boardId,
  subBoards,
  onCreated,
}: {
  boardId: string;
  subBoards: number;
  onCreated: (link: ShareLink) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Open at first, as the approved mockup; closed after a link is made, to show it.
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<LinkDraft>(newDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLDivElement>(null);
  const reopened = useRef(false);
  const set = (patch: Partial<LinkDraft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (open && reopened.current) form.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);

  const close = () => {
    setDraft(newDraft());
    setError(null);
    setOpen(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.password.mode === 'set' && draft.password.value.length < MIN_PASSWORD) {
      setError(t('guestLinks.passwordShort', { min: MIN_PASSWORD }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const link = await api.post<ShareLink>(`/boards/${boardId}/share-links`, createOf(draft));
      close();
      await onCreated(link);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div ref={opener} data-tour="share-guest-form">
        <Button
          variant="primary"
          icon="link"
          onClick={() => {
            reopened.current = true;
            setOpen(true);
          }}
        >
          {t('guestLinks.new')}
        </Button>
      </div>
    );
  }

  return (
    <form
      ref={form}
      className="guest-links__form"
      onSubmit={submit}
      aria-label={t('guestLinks.new')}
      data-tour="share-guest-form"
    >
      <LinkFields draft={draft} set={set} scope subBoards={subBoards} />
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      <FormFooter
        draft={draft}
        subBoards={subBoards}
        busy={busy}
        onCancel={() => {
          close();
          requestAnimationFrame(() => opener.current?.querySelector('button')?.focus());
        }}
        submit={
          <Button type="submit" variant="primary" icon="link" disabled={busy}>
            {t('guestLinks.create')}
          </Button>
        }
      />
    </form>
  );
}

function LinkRow({
  link,
  fresh,
  scope,
  subBoards,
  onChanged,
  onError,
  onResults,
}: {
  link: ShareLink;
  fresh: boolean;
  scope: boolean;
  subBoards: number;
  onChanged: () => Promise<void>;
  onError: (err: unknown) => void;
  onResults: () => void;
}) {
  const { t, i18n } = useTranslation();
  const status = statusOf(link);
  const [mode, setMode] = useState<'view' | 'edit' | 'revoke'>('view');
  const [busy, setBusy] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const titleId = `guest-link-${link.id}`;
  const name =
    link.label ??
    t(`guestLinks.roles.${GUEST_ROLES.includes(link.role) ? link.role : 'guest_view'}`);
  const menuLabel = t('guestLinks.actionsFor', { name });
  const items = [
    status !== 'revoked' && { label: t('guestLinks.edit'), action: () => setMode('edit') },
    (link.proofing || link.guestCount > 0) && { label: t('guestLinks.results'), action: onResults },
    status !== 'revoked' && {
      label: t('guestLinks.revoke'),
      action: () => setMode('revoke'),
      danger: true,
    },
  ].filter((item) => !!item);
  const menu = useMenu(menuLabel, items);

  useEffect(() => {
    if (mode === 'revoke') row.current?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
  }, [mode]);

  const back = () => {
    setMode('view');
    requestAnimationFrame(() => document.getElementById(titleId)?.focus());
  };

  const facts = [
    t(`guestLinks.roles.${GUEST_ROLES.includes(link.role) ? link.role : 'guest_view'}`),
    link.hasPassword ? t('guestLinks.facts.password') : null,
    link.allowDownload ? t('guestLinks.facts.download') : null,
    link.proofing ? t('guestLinks.facts.proofing') : null,
    subBoards > 0 && link.includeSubBoards ? t('guestLinks.facts.subBoards') : null,
    link.expiresAt
      ? t(status === 'expired' ? 'guestLinks.facts.expired' : 'guestLinks.facts.expires', {
          date: formatDate(link.expiresAt, i18n.language),
        })
      : t('guestLinks.facts.noExpiry'),
  ].filter(Boolean);

  return (
    <li ref={row} className={`guest-link guest-link--${status}`}>
      <div className="guest-link__row">
        <span className="share__icon-avatar" aria-hidden="true">
          <Icon name="link" size={14} />
        </span>
        <span className="share__who">
          <span className="share__name" id={titleId} tabIndex={-1}>
            {name}
          </span>
          <span className="share__sub">{facts.join(' · ')}</span>
          <span className="share__sub">
            {[
              link.createdBy ? t('guestLinks.createdBy', { name: link.createdBy.name }) : null,
              link.lastUsedAt
                ? t('guestLinks.lastUsed', { when: relativeTime(link.lastUsedAt, i18n.language) })
                : t('guestLinks.neverUsed'),
              link.viewCount > 0
                ? t('guestLinks.usage', { count: link.viewCount, guests: link.guestCount })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {/* Active is the usual state: only the others are named. */}
        {status !== 'active' && (
          <span className={`guest-link__status guest-link__status--${status}`}>
            {t(`guestLinks.status.${status}`)}
          </span>
        )}
        {link.url && <CopyLink text={link.url} name={name} />}
        {items.length > 0 && (
          <>
            <IconButton
              icon="more"
              label={menuLabel}
              aria-haspopup="menu"
              aria-expanded={menu.isOpen}
              onClick={(e) => menu.open(e.currentTarget, e.currentTarget)}
            />
            {menu.layer}
          </>
        )}
      </div>
      {/* A link just made is shown whole, ready to copy also where the clipboard is not allowed. */}
      {fresh && link.url && mode === 'view' && (
        <input
          className="ink-input guest-link__url"
          readOnly
          data-feedback-secret
          value={link.url}
          aria-label={t('guestLinks.url', { name })}
          // biome-ignore lint/a11y/noAutofocus: the link was just created, ready to copy
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {status === 'suspended' && (
        <p className="guest-link__explain">{t('guestLinks.suspendedWhy')}</p>
      )}
      {status === 'revoked' && link.revokedAt && (
        <p className="guest-link__explain">
          {t('guestLinks.revokedOn', { date: formatDate(link.revokedAt, i18n.language) })}
        </p>
      )}
      {mode === 'revoke' && (
        <section className="guest-link__confirm" aria-label={t('guestLinks.revokeTitle')}>
          <p>{t('guestLinks.revokeBody')}</p>
          <div className="guest-links__actions">
            <Button variant="ghost" disabled={busy} onClick={back}>
              {t('guestLinks.cancel')}
            </Button>
            <Button
              variant="danger"
              data-confirm
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.delete(`/share-links/${link.id}`);
                  setMode('view');
                  await onChanged();
                  requestAnimationFrame(() => document.getElementById(titleId)?.focus());
                } catch (err) {
                  onError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('guestLinks.revokeConfirm')}
            </Button>
          </div>
        </section>
      )}
      {mode === 'edit' && (
        <EditForm
          link={link}
          scope={scope}
          subBoards={subBoards}
          onCancel={back}
          onSaved={async () => {
            await onChanged();
            back();
          }}
          onError={onError}
        />
      )}
    </li>
  );
}

function CopyLink({ text, name }: { text: string; name: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      icon="copy"
      aria-label={copied ? undefined : t('guestLinks.copyLabel', { name })}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? t('share.copied') : t('guestLinks.copy')}
    </Button>
  );
}

function EditForm({
  link,
  scope,
  subBoards,
  onCancel,
  onSaved,
  onError,
}: {
  link: ShareLink;
  scope: boolean;
  subBoards: number;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LinkDraft>(() => draftOf(link));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<LinkDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.password.mode === 'set' && draft.password.value.length < MIN_PASSWORD) {
      setError(t('guestLinks.passwordShort', { min: MIN_PASSWORD }));
      return;
    }
    const patch = patchOf(link, draft, scope);
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/share-links/${link.id}`, patch);
      await onSaved();
    } catch (err) {
      setError(errorText(t, err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={box}
      className="guest-links__form"
      onSubmit={submit}
      aria-label={t('guestLinks.editTitle')}
    >
      {!scope && <p className="guest-links__hint">{t('guestLinks.scopeOnly')}</p>}
      <LinkFields draft={draft} set={set} link={link} scope={scope} subBoards={subBoards} />
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      <FormFooter
        draft={draft}
        link={link}
        subBoards={subBoards}
        busy={busy}
        onCancel={onCancel}
        submit={
          <Button type="submit" variant="primary" disabled={busy}>
            {t('guestLinks.save')}
          </Button>
        }
      />
    </form>
  );
}

function PicksView({ link, onBack }: { link: ShareLink; onBack: () => void }) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<ShareLinkPicks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const name =
    link.label ??
    t(`guestLinks.roles.${GUEST_ROLES.includes(link.role) ? link.role : 'guest_view'}`);

  useEffect(() => {
    heading.current?.focus();
    api
      .get<ShareLinkPicks>(`/share-links/${link.id}/picks`)
      .then(setPicks)
      .catch((err) => setError(errorText(t, err)));
  }, [link.id, t]);

  const guestName = (id: string) => {
    const index = picks?.guests.findIndex((g) => g.id === id) ?? -1;
    const g = picks?.guests[index];
    return g?.name ?? t('guestLinks.picks.anonymous', { n: index + 1 });
  };
  const choice = (pick: 'picked' | 'rejected' | null, stars: number | null) =>
    [
      pick ? t(`guestLinks.picks.${pick}`) : null,
      stars ? t('guestLinks.picks.stars', { count: stars }) : null,
    ]
      .filter(Boolean)
      .join(', ');
  const names = picks ? pickedFileNames(picks) : [];
  const unnamed = picks ? pickedWithoutName(picks) : 0;
  const base = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'link'}`;

  return (
    <div className="guest-links">
      <div className="guest-picks-head">
        <IconButton
          icon="chevronRight"
          label={t('guestLinks.picks.back')}
          className="guest-picks-head__back"
          onClick={onBack}
        />
        <h3 className="guest-picks-head__title" ref={heading} tabIndex={-1}>
          {t('guestLinks.picks.title', { name })}
        </h3>
      </div>
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      {picks && (
        <>
          <p className="share__note ink-muted">
            {t('guestLinks.picks.summary', {
              guests: picks.guests.length,
              count: picks.items.length,
            })}
          </p>
          <div className="guest-links__actions guest-links__actions--start">
            <Button
              icon="download"
              disabled={names.length === 0}
              onClick={() =>
                saveFile(`${base}-scelte.txt`, namesText(names), 'text/plain;charset=utf-8')
              }
            >
              {t('guestLinks.picks.exportNames')}
            </Button>
            <Button
              icon="download"
              disabled={picks.items.length === 0}
              onClick={() =>
                saveFile(
                  `${base}.csv`,
                  `\uFEFF${picksCsv(picks, {
                    file: t('guestLinks.picks.file'),
                    picked: t('guestLinks.picks.pickedCount'),
                    rejected: t('guestLinks.picks.rejectedCount'),
                    stars: t('guestLinks.picks.starsAverage'),
                    ratings: t('guestLinks.picks.starsCount'),
                    guest: (g, i) => g ?? t('guestLinks.picks.anonymous', { n: i + 1 }),
                    choice,
                  })}`,
                  'text/csv;charset=utf-8',
                )
              }
            >
              {t('guestLinks.picks.exportCsv')}
            </Button>
          </div>
          {unnamed > 0 && (
            <p className="guest-links__hint">{t('guestLinks.picks.unnamed', { count: unnamed })}</p>
          )}
          {picks.items.length === 0 ? (
            <p className="share__note ink-muted">{t('guestLinks.picks.none')}</p>
          ) : (
            <ul className="guest-picks-list" aria-label={t('guestLinks.picks.list')}>
              {picks.items.map((item) => (
                <li key={`${item.boardId}/${item.elementId}`} className="guest-picks-item">
                  <span className="guest-picks-item__name">
                    {item.variants?.[0] ? (
                      <img
                        className="guest-picks-item__thumbnail"
                        src={item.variants[0].url}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <Icon name="image" size={14} />
                    )}
                    {item.filename ?? t('guestLinks.picks.noName')}
                  </span>
                  <span className="guest-picks-item__totals">
                    {t('guestLinks.picks.totals', {
                      picked: item.picked,
                      rejected: item.rejected,
                    })}
                    {item.starsAverage !== null &&
                      ` · ${t('guestLinks.picks.average', {
                        value: item.starsAverage.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        }),
                        count: item.starsCount,
                      })}`}
                  </span>
                  <ul className="guest-picks-item__guests">
                    {item.byGuest.map((b) => (
                      <li key={b.guestId}>
                        {t('guestLinks.picks.byGuest', {
                          name: guestName(b.guestId),
                          choice: choice(b.pick, b.stars) || '—',
                        })}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
