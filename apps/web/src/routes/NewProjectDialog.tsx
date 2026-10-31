import {
  type InvitationResult,
  type Person,
  type Project,
  type ProjectRole,
  type ProjectType,
  z,
} from '@inkadra/shared';
import {
  Avatar,
  Button,
  ChoiceTile,
  DateField,
  Dialog,
  DialogActions,
  type DialogHandle,
  Icon,
  kindStyle,
  Select,
  TextField,
} from '@inkadra/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { castName, type ImportPlan } from '../board/film/screenplay/plan.ts';
import { ScreenplayImportDialog } from '../board/film/screenplay/ScreenplayImportDialog.tsx';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { useSession } from '../lib/session.tsx';
import { PeoplePicker } from '../people/PeoplePicker.tsx';
import { ProjectSetupSeed } from './ProjectSetupSeed.tsx';
import {
  type CreatedSetupBoard,
  createSetupBoards,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  setupBoards,
  TEMPLATE_ICONS,
} from './project-setup.ts';
import './projects.css';

/** Blank first: it is the default, and the rest read as ready-made starts. */
const TEMPLATE_ORDER: ProjectTemplate[] = [
  'blank',
  ...PROJECT_TEMPLATES.filter((v) => v !== 'blank'),
];

interface Invite {
  email: string;
  role: ProjectRole;
  /** The account's name, when picked from the suggestions. */
  name?: string;
  image?: string | null;
}

export function NewProjectDialog({
  open,
  template,
  onClose,
  onCreated,
  onImport,
}: {
  open: boolean;
  /** Preselected, as when opened from a template on Home. */
  template?: ProjectTemplate;
  onClose: () => void;
  /** Switches to Import project… for someone holding an archive. */
  onImport?: () => void;
  onCreated: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dialog = useRef<DialogHandle>(null);
  return (
    <Dialog
      ref={dialog}
      open={open}
      dirty={dirty}
      title={t('project.dialogTitle')}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      {open && (
        <ProjectSetupForm
          template={template}
          onClose={() => dialog.current?.requestClose()}
          onCreated={onCreated}
          onImport={onImport}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
        />
      )}
    </Dialog>
  );
}

export function ProjectSetupForm({
  template: initialTemplate = 'blank',
  onClose,
  onCreated,
  onImport,
  onBusyChange,
  onDirtyChange,
}: {
  template?: ProjectTemplate;
  onClose: () => void;
  onCreated: (p: Project) => void;
  /** Shows a quiet Import archive… link in the footer. */
  onImport?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Whether something was typed or chosen that closing would lose. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { catalogs, typeLabel } = useClassifications();
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const detailsId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType | ''>('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [template, setTemplate] = useState<ProjectTemplate>(initialTemplate);
  const [details, setDetails] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteError, setInviteError] = useState(false);
  const [results, setResults] = useState<InvitationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const [seeding, setSeeding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screenplay, setScreenplay] = useState<ImportPlan | null>(null);
  const [pickingScript, setPickingScript] = useState(false);
  // The screenplay fills the template's storyboard instead of its sample scene.
  const withStoryboard = setupBoards(template).some((b) => b.kind === 'storyboard');
  const progress = useRef<{
    project: Project | null;
    boards: CreatedSetupBoard[];
    seeded: number;
    invitations: InvitationResult[];
  }>({ project: null, boards: [], seeded: 0, invitations: [] });
  // The list the running creation invites, including an address left typed in the field.
  const inviteList = useRef(invites);
  inviteList.current = invites;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const locked = busy || !!progress.current.project;
  const dirty =
    !created &&
    !locked &&
    !!(name.trim() || start || end || email.trim() || invites.length || screenplay);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Nothing is left to lose once the form is gone.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const dateError = !!start && !!end && end < start;
  const address = email.trim().toLowerCase();
  /** A complete address still in the field: Create invites it too, a half-typed one is ignored. */
  const pending =
    z.email().safeParse(address).success && !invites.some((i) => i.email === address)
      ? { email: address, role }
      : null;
  const inviteCount = invites.length + (pending ? 1 : 0);
  const add = (invite: Invite) => {
    setInvites((list) => (list.some((i) => i.email === invite.email) ? list : [...list, invite]));
    setEmail('');
    setInviteError(false);
  };
  const addInvite = () => {
    if (!pending) {
      setInviteError(true);
      return;
    }
    add(pending);
  };
  const pick = (person: Person) => {
    if (person.email)
      add({ email: person.email.toLowerCase(), role, name: person.name, image: person.image });
  };
  async function inviteTeam() {
    const p = progress.current;
    if (!p.project) return;
    const list = inviteList.current;
    try {
      for (let i = p.invitations.length; i < list.length; i++) {
        const invite = list[i];
        if (!invite) continue;
        p.invitations.push(
          await api.post<InvitationResult>('/invitations', {
            kind: 'email',
            projectId: p.project.id,
            email: invite.email,
            role: invite.role,
          }),
        );
        setResults([...p.invitations]);
      }
      setCreated(p.project);
      if (list.length === 0) onCreated(p.project);
    } catch {
      setError(t('onboarding.partialError'));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || dateError || busy) return;
    if (pending) {
      const list = [...invites, pending];
      setInvites(list);
      inviteList.current = list;
      setEmail('');
    }
    setBusy(true);
    setError(null);
    try {
      const p = progress.current;
      p.project ??= await api.post<Project>('/projects', {
        name,
        type: type || null,
        shootingStart: start || null,
        shootingEnd: end || null,
      });
      await createSetupBoards(p.project, template, p.boards, (key) =>
        t(`onboarding.boards.${key}`),
      );
      if (p.seeded <= p.boards.length) setSeeding(p.seeded);
      else await inviteTeam();
    } catch {
      setBusy(false);
      setError(t(progress.current.project ? 'onboarding.partialError' : 'auth.errors.generic'));
    }
  }
  const seedDone = () => {
    const next = ++progress.current.seeded;
    if (next <= progress.current.boards.length) setSeeding(next);
    else {
      setSeeding(null);
      void inviteTeam();
    }
  };
  const seedFailed = () => {
    setSeeding(null);
    setBusy(false);
    setError(t('onboarding.partialError'));
  };
  const seedBoard = seeding === null ? null : progress.current.boards[seeding];
  const project = progress.current.project;
  return (
    <form className="project-setup" onSubmit={submit}>
      <fieldset disabled={locked || !!created} className="project-setup__fields">
        <TextField
          className="project-setup__name"
          label={t('project.name')}
          placeholder={t('project.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={120}
          required
        />
        <fieldset className="project-setup__templates">
          <legend>{t('onboarding.startFrom')}</legend>
          <div className="project-setup__template-grid">
            {TEMPLATE_ORDER.map((v) => (
              <ChoiceTile
                key={v}
                variant="card"
                className="project-setup__template"
                name="projectTemplate"
                value={v}
                checked={template === v}
                onChange={() => setTemplate(v)}
              >
                <span
                  className="project-setup__template-icon"
                  style={kindStyle(v)}
                  aria-hidden="true"
                >
                  <Icon name={TEMPLATE_ICONS[v]} size={14} />
                </span>
                <span className="project-setup__template-name">
                  {t(`onboarding.templates.${v}.name`)}
                </span>
              </ChoiceTile>
            ))}
          </div>
          <p className="project-setup__hint">{t(`onboarding.templates.${template}.body`)}</p>
        </fieldset>
        {withStoryboard && (
          <div className="project-setup__script">
            <span className="project-setup__script-text">
              <strong>{t('screenplay.setup.label')}</strong>
              <small className="ink-muted">
                {screenplay
                  ? t('screenplay.setup.chosen', {
                      title: screenplay.title
                        ? castName(screenplay.title)
                        : t('screenplay.untitled'),
                      scenes: t('screenplay.scenes', { count: screenplay.scenes.length }),
                      frames: t('screenplay.framesCount', { count: screenplay.frameCount }),
                    })
                  : t('screenplay.setup.hint')}
              </small>
            </span>
            {screenplay ? (
              <Button variant="ghost" onClick={() => setScreenplay(null)}>
                {t('screenplay.setup.remove')}
              </Button>
            ) : (
              <Button icon="upload" onClick={() => setPickingScript(true)}>
                {t('screenplay.open')}
              </Button>
            )}
          </div>
        )}
        <div className="project-setup__details">
          <button
            type="button"
            className="project-setup__disclosure"
            aria-expanded={details}
            aria-controls={detailsId}
            onClick={() => setDetails((open) => !open)}
          >
            <Icon name="chevronRight" size={16} />
            {t('onboarding.details')}
            <small>· {t('onboarding.detailsHint')}</small>
          </button>
          {details && (
            <div id={detailsId} className="project-setup__details-body">
              <fieldset className="project-setup__choices">
                <legend>{t('onboarding.type')}</legend>
                {catalogs.projectTypes
                  .filter((o) => !o.archived)
                  .map(({ id: v }) => (
                    <ChoiceTile
                      key={v}
                      name="projectType"
                      value={v}
                      checked={type === v}
                      onChange={() => setType(v)}
                    >
                      {typeLabel(v)}
                    </ChoiceTile>
                  ))}
              </fieldset>
              <div className="project-setup__dates">
                <DateField
                  label={t('onboarding.start')}
                  clearLabel={t('onboarding.clearDate', { label: t('onboarding.start') })}
                  value={start}
                  onChange={setStart}
                />
                <DateField
                  label={t('onboarding.end')}
                  clearLabel={t('onboarding.clearDate', { label: t('onboarding.end') })}
                  value={end}
                  min={start || undefined}
                  onChange={setEnd}
                />
              </div>
              <fieldset className="project-setup__invites">
                <legend>{t('onboarding.invite')}</legend>
                <div className="project-setup__invite-entry">
                  <PeoplePicker
                    className="project-setup__people"
                    inputClassName="ink-input"
                    aria-label={t('onboarding.people')}
                    placeholder={t('onboarding.peoplePlaceholder')}
                    aria-invalid={inviteError || undefined}
                    value={email}
                    onChange={(value) => {
                      setEmail(value);
                      setInviteError(false);
                    }}
                    onPick={pick}
                    exclude={(p) => invites.some((i) => i.email === p.email?.toLowerCase())}
                    onKeyDown={(e) => {
                      // Enter adds the typed address instead of creating the project.
                      if (e.key === 'Enter' && !e.defaultPrevented && email.trim()) {
                        e.preventDefault();
                        addInvite();
                      }
                    }}
                  />
                  <Select
                    className="ink-input project-setup__role"
                    aria-label={t('onboarding.role')}
                    value={role}
                    onChange={(e) => setRole(e as ProjectRole)}
                  >
                    {['editor', 'commenter', 'viewer', 'owner'].map((v) => (
                      <option key={v} value={v}>
                        {t(`roles.${v}`)}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={addInvite} disabled={!email.trim()}>
                    {t('onboarding.add')}
                  </Button>
                </div>
                {inviteError && (
                  <p className="project-setup__invite-error" role="alert">
                    {t('onboarding.invalidEmail')}
                  </p>
                )}
                {invites.length > 0 && (
                  <ul className="project-setup__people-list">
                    {invites.map((invite) => (
                      <li key={invite.email}>
                        <Avatar name={invite.name || invite.email} image={invite.image} size={20} />
                        <span className="project-setup__person">
                          {invite.name || invite.email} · {t(`roles.${invite.role}`)}
                        </span>
                        <button
                          type="button"
                          className="project-setup__remove"
                          aria-label={t('onboarding.removeNamed', { email: invite.email })}
                          onClick={() => setInvites((list) => list.filter((i) => i !== invite))}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!instance?.auth.email && (
                  <p className="project-setup__hint">{t('onboarding.noSmtp')}</p>
                )}
              </fieldset>
            </div>
          )}
        </div>
      </fieldset>
      {(error || dateError) && (
        <p role="alert">{dateError ? t('onboarding.invalidDates') : error}</p>
      )}
      {busy && <p role="status">{t('onboarding.creating')}</p>}
      {results.length > 0 && (
        <section aria-label={t('onboarding.inviteResults')}>
          <h2>{t('onboarding.inviteResults')}</h2>
          {results.map((result) => {
            if (result.status === 'added') {
              const { user } = result.entry;
              return <p key={user.id}>{t('share.added', { name: user.name || user.email })}</p>;
            }
            const invite = result.invitation;
            return (
              <p key={invite.id}>
                {invite.email} · {t(invite.emailSent ? 'onboarding.sent' : 'onboarding.copyLink')}{' '}
                {invite.url && (
                  <input
                    className="ink-input"
                    aria-label={t('onboarding.linkFor', { email: invite.email })}
                    value={invite.url}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                )}
              </p>
            );
          })}
        </section>
      )}
      <DialogActions>
        {onImport && !created && (
          <button
            type="button"
            className="project-setup__import"
            disabled={locked}
            onClick={onImport}
          >
            {t('transfer.importArchive')}
          </button>
        )}
        {!created && (
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('project.cancel')}
          </Button>
        )}
        {created ? (
          <Button variant="primary" onClick={() => onCreated(created)}>
            {t('projectsPage.open')}
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || dateError}>
            {error && project
              ? t('projectsPage.retry')
              : inviteCount
                ? t('onboarding.createAndInvite', { count: inviteCount })
                : t('project.create')}
          </Button>
        )}
      </DialogActions>
      {seeding !== null && project && user && (
        <ProjectSetupSeed
          key={seedBoard?.board.id ?? project.rootBoardId}
          boardId={seedBoard?.board.id ?? project.rootBoardId}
          seed={seedBoard?.seed}
          screenplay={
            withStoryboard && seedBoard?.board.kind === 'storyboard'
              ? (screenplay ?? undefined)
              : undefined
          }
          links={seedBoard ? undefined : progress.current.boards}
          userId={user.id}
          done={seedDone}
          failed={seedFailed}
        />
      )}
      {pickingScript && (
        <ScreenplayImportDialog
          targets={['new']}
          confirmLabel={t('screenplay.use')}
          onImport={(plan) => {
            setScreenplay(plan);
            if (!name.trim() && plan.title) setName(castName(plan.title).slice(0, 120));
          }}
          onClose={() => setPickingScript(false)}
        />
      )}
    </form>
  );
}
