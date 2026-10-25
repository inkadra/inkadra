import type {
  BoardDetail,
  CreateShareLink,
  GuestRole,
  ShareLink,
  ShareLinkPicks,
} from '@inkadra/shared';
import { Button, Icon, IconButton } from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import {
  canChangeScope,
  draftOf,
  EXPIRY_DAYS,
  GUEST_ROLES,
  type LinkDraft,
  MIN_PASSWORD,
  namesText,
  patchOf,
  pickedFileNames,
  pickedWithoutName,
  picksCsv,
  statusOf,
} from './guest-links.ts';
import './guest-links.css';

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
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
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
      <p className="share__lead ink-muted">{t('guestLinks.lead')}</p>
      <CreateForm
        boardId={board.id}
        subBoards={subBoards}
        onCreated={async (link) => {
          setFresh(link.id);
          setError(null);
          await load();
        }}
      />
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      {links && links.length === 0 && (
        <p className="share__note ink-muted">{t('guestLinks.none')}</p>
      )}
      {links && links.length > 0 && (
        <ul className="guest-links__list" aria-label={t('guestLinks.list')}>
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
              }}
              onError={(err) => setError(errorText(t, err))}
              onResults={() => setResults(link)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: GuestRole;
  onChange: (role: GuestRole) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="guest-links__field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="guest-links__select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as GuestRole)}
      >
        {GUEST_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`guestLinks.roles.${r}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="guest-links__check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={`${id}-hint`} className="guest-links__hint">
          {hint}
        </span>
      )}
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
  const ids = { label: useId(), password: useId(), expiry: useId() };
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<GuestRole>('guest_view');
  const [label, setLabel] = useState('');
  const [includeSubBoards, setIncludeSubBoards] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [proofing, setProofing] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [days, setDays] = useState<number | 0>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) first.current?.querySelector('select')?.focus();
  }, [open]);

  const reset = () => {
    setRole('guest_view');
    setLabel('');
    setIncludeSubBoards(true);
    setAllowDownload(false);
    setProofing(false);
    setUsePassword(false);
    setPassword('');
    setDays(0);
    setError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (usePassword && password.length < MIN_PASSWORD) {
      setError(t('guestLinks.passwordShort', { min: MIN_PASSWORD }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateShareLink = {
        role,
        includeSubBoards,
        allowDownload,
        proofing,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(usePassword ? { password } : {}),
        ...(days ? { expiresInDays: days } : {}),
      };
      const link = await api.post<ShareLink>(`/boards/${boardId}/share-links`, body);
      reset();
      setOpen(false);
      await onCreated(link);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div ref={opener}>
        <Button variant="primary" icon="link" onClick={() => setOpen(true)}>
          {t('guestLinks.new')}
        </Button>
      </div>
    );
  }

  return (
    <form className="guest-links__form" onSubmit={submit} aria-label={t('guestLinks.new')}>
      <div className="guest-links__grid" ref={first}>
        <RoleSelect value={role} onChange={setRole} label={t('guestLinks.role')} />
        <div className="guest-links__field">
          <label htmlFor={ids.expiry}>{t('guestLinks.expiry')}</label>
          <select
            id={ids.expiry}
            className="guest-links__select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={0}>{t('guestLinks.never')}</option>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('share.link.days', { count: d })}
              </option>
            ))}
          </select>
        </div>
        <div className="guest-links__field guest-links__field--wide">
          <label htmlFor={ids.label}>{t('guestLinks.label')}</label>
          <input
            id={ids.label}
            className="share__url guest-links__input"
            value={label}
            maxLength={80}
            placeholder={t('guestLinks.labelPlaceholder')}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      {subBoards > 0 && (
        <Check
          label={t('guestLinks.includeSubBoards', { count: subBoards })}
          checked={includeSubBoards}
          onChange={setIncludeSubBoards}
        />
      )}
      <Check
        label={t('guestLinks.allowDownload')}
        hint={t('guestLinks.allowDownloadHint')}
        checked={allowDownload}
        onChange={setAllowDownload}
      />
      <Check
        label={t('guestLinks.proofing')}
        hint={t('guestLinks.proofingHint')}
        checked={proofing}
        onChange={setProofing}
      />
      <Check label={t('guestLinks.usePassword')} checked={usePassword} onChange={setUsePassword} />
      {usePassword && (
        <div className="guest-links__field guest-links__field--wide">
          <label htmlFor={ids.password}>{t('guestLinks.password')}</label>
          <input
            id={ids.password}
            className="share__url guest-links__input"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      <div className="guest-links__actions">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            reset();
            setOpen(false);
            requestAnimationFrame(() => opener.current?.querySelector('button')?.focus());
          }}
        >
          {t('guestLinks.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('guestLinks.create')}
        </Button>
      </div>
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
      <div className="guest-link__head">
        <span className="share__who">
          <span className="share__name" id={titleId} tabIndex={-1}>
            {name}
          </span>
          <span className="guest-link__facts">{facts.join(' · ')}</span>
          <span className="share__sub">
            {[
              link.createdBy ? t('guestLinks.createdBy', { name: link.createdBy.name }) : null,
              t('guestLinks.usage', { count: link.viewCount, guests: link.guestCount }),
              link.lastUsedAt
                ? t('guestLinks.lastUsed', {
                    date: formatDate(link.lastUsedAt, i18n.language, true),
                  })
                : t('guestLinks.neverUsed'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className={`guest-link__status guest-link__status--${status}`}>
          {t(`guestLinks.status.${status}`)}
        </span>
      </div>
      {status === 'suspended' && (
        <p className="guest-link__explain">{t('guestLinks.suspendedWhy')}</p>
      )}
      {status === 'revoked' && link.revokedAt && (
        <p className="guest-link__explain">
          {t('guestLinks.revokedOn', { date: formatDate(link.revokedAt, i18n.language) })}
        </p>
      )}
      {link.url && mode === 'view' && (
        <div className="share__link-row">
          <input
            className="share__input share__url"
            readOnly
            value={link.url}
            aria-label={t('guestLinks.url', { name })}
            // biome-ignore lint/a11y/noAutofocus: the link was just created, ready to copy
            autoFocus={fresh}
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyLink text={link.url} />
        </div>
      )}
      {mode === 'view' && (
        <div className="guest-link__actions">
          {status !== 'revoked' && (
            <Button variant="ghost" onClick={() => setMode('edit')}>
              {t('guestLinks.edit')}
            </Button>
          )}
          {(link.proofing || link.guestCount > 0) && (
            <Button variant="ghost" onClick={onResults}>
              {t('guestLinks.results')}
            </Button>
          )}
          {status !== 'revoked' && (
            <Button variant="ghost" onClick={() => setMode('revoke')}>
              {t('guestLinks.revoke')}
            </Button>
          )}
        </div>
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

function CopyLink({ text }: { text: string }) {
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
  const ids = { label: useId(), password: useId(), expiry: useId(), pwMode: useId() };
  const set = (patch: Partial<LinkDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('select:not(:disabled), input')?.focus();
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
      <div className="guest-links__grid">
        <RoleSelect
          value={draft.role}
          onChange={(role) => set({ role })}
          disabled={!scope}
          label={t('guestLinks.role')}
        />
        <div className="guest-links__field">
          <label htmlFor={ids.expiry}>{t('guestLinks.expiry')}</label>
          <select
            id={ids.expiry}
            className="guest-links__select"
            disabled={!scope}
            value={String(draft.expiry)}
            onChange={(e) => {
              const v = e.target.value;
              set({ expiry: v === 'keep' || v === 'none' ? v : Number(v) });
            }}
          >
            <option value="keep">{t('guestLinks.keepExpiry')}</option>
            <option value="none">{t('guestLinks.never')}</option>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('guestLinks.fromNow', { count: d })}
              </option>
            ))}
          </select>
        </div>
        <div className="guest-links__field guest-links__field--wide">
          <label htmlFor={ids.label}>{t('guestLinks.label')}</label>
          <input
            id={ids.label}
            className="share__url guest-links__input"
            value={draft.label}
            maxLength={80}
            placeholder={t('guestLinks.labelPlaceholder')}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
      </div>
      {subBoards > 0 && (
        <Check
          label={t('guestLinks.includeSubBoards', { count: subBoards })}
          checked={draft.includeSubBoards}
          disabled={!scope}
          onChange={(includeSubBoards) => set({ includeSubBoards })}
        />
      )}
      <Check
        label={t('guestLinks.allowDownload')}
        checked={draft.allowDownload}
        disabled={!scope}
        onChange={(allowDownload) => set({ allowDownload })}
      />
      <Check
        label={t('guestLinks.proofing')}
        checked={draft.proofing}
        disabled={!scope}
        onChange={(proofing) => set({ proofing })}
      />
      <div className="guest-links__field guest-links__field--wide">
        <label htmlFor={ids.pwMode}>{t('guestLinks.password')}</label>
        <select
          id={ids.pwMode}
          className="guest-links__select"
          disabled={!scope}
          value={draft.password.mode}
          onChange={(e) =>
            set({ password: { mode: e.target.value as LinkDraft['password']['mode'], value: '' } })
          }
        >
          <option value="keep">
            {link.hasPassword ? t('guestLinks.passwordKeep') : t('guestLinks.passwordNone')}
          </option>
          <option value="set">
            {link.hasPassword ? t('guestLinks.passwordChange') : t('guestLinks.passwordAdd')}
          </option>
          {link.hasPassword && <option value="remove">{t('guestLinks.passwordRemove')}</option>}
        </select>
        {draft.password.mode === 'set' && (
          <>
            <label htmlFor={ids.password} className="guest-links__sr">
              {t('guestLinks.newPassword')}
            </label>
            <input
              id={ids.password}
              className="share__url guest-links__input"
              type="password"
              autoComplete="new-password"
              placeholder={t('guestLinks.newPassword')}
              minLength={MIN_PASSWORD}
              maxLength={128}
              value={draft.password.value}
              onChange={(e) => set({ password: { mode: 'set', value: e.target.value } })}
            />
            {link.hasPassword && (
              <span className="guest-links__hint">{t('guestLinks.passwordChangeHint')}</span>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="share__error" role="alert">
          {error}
        </p>
      )}
      <div className="guest-links__actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('guestLinks.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('guestLinks.save')}
        </Button>
      </div>
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
