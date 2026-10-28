import {
  type InvitationResult,
  type Project,
  type ProjectRole,
  type ProjectType,
  z,
} from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { useSession } from '../lib/session.tsx';
import { ProjectSetupSeed } from './ProjectSetupSeed.tsx';
import {
  type CreatedSetupBoard,
  createSetupBoards,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  setupBoards,
} from './project-setup.ts';
import './projects.css';

export function NewProjectDialog({
  open,
  template,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Preselected, as when opened from a template on Home. */
  template?: ProjectTemplate;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      title={t('project.dialogTitle')}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      {open && (
        <ProjectSetupForm
          template={template}
          onClose={onClose}
          onCreated={onCreated}
          onBusyChange={setBusy}
        />
      )}
    </Dialog>
  );
}

export function ProjectSetupForm({
  template: initialTemplate = 'blank',
  onClose,
  onCreated,
  onBusyChange,
}: {
  template?: ProjectTemplate;
  onClose: () => void;
  onCreated: (p: Project) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { catalogs, typeLabel } = useClassifications();
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType | ''>('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [template, setTemplate] = useState<ProjectTemplate>(initialTemplate);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const [invites, setInvites] = useState<Array<{ email: string; role: ProjectRole }>>([]);
  const [results, setResults] = useState<InvitationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const [seeding, setSeeding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useRef<{
    project: Project | null;
    boards: CreatedSetupBoard[];
    seeded: number;
    invitations: InvitationResult[];
  }>({ project: null, boards: [], seeded: 0, invitations: [] });
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const locked = busy || !!progress.current.project;
  const dateError = !!start && !!end && end < start;
  const addInvite = () => {
    const address = email.trim().toLowerCase();
    if (!z.email().safeParse(address).success || invites.some((i) => i.email === address)) {
      setError(t('onboarding.invalidEmail'));
      return;
    }
    setInvites((list) => [...list, { email: address, role }]);
    setEmail('');
    setError(null);
  };
  async function inviteTeam() {
    const p = progress.current;
    if (!p.project) return;
    try {
      for (let i = p.invitations.length; i < invites.length; i++) {
        const invite = invites[i];
        if (!invite) continue;
        p.invitations.push(
          await api.post<InvitationResult>('/invitations', {
            kind: 'email',
            projectId: p.project.id,
            ...invite,
          }),
        );
        setResults([...p.invitations]);
      }
      setCreated(p.project);
      if (invites.length === 0) onCreated(p.project);
    } catch {
      setError(t('onboarding.partialError'));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || dateError || busy || email.trim()) return;
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
        <div className="project-setup__dates">
          <TextField
            label={t('project.name')}
            placeholder={t('project.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={120}
            required
          />
          <TextField
            type="date"
            label={t('onboarding.start')}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            type="date"
            label={t('onboarding.end')}
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <fieldset className="project-setup__choices">
          <legend>{t('onboarding.type')}</legend>
          {catalogs.projectTypes
            .filter((o) => !o.archived)
            .map(({ id: v }) => (
              <label key={v}>
                <input
                  type="radio"
                  name="projectType"
                  checked={type === v}
                  onChange={() => setType(v)}
                />
                {typeLabel(v)}
              </label>
            ))}
        </fieldset>
        <fieldset className="project-setup__templates">
          <legend>{t('onboarding.template')}</legend>
          {PROJECT_TEMPLATES.map((v) => (
            <label key={v} className="ink-card">
              <input
                type="radio"
                name="projectTemplate"
                checked={template === v}
                onChange={() => setTemplate(v)}
              />
              <span>
                <strong>{t(`onboarding.templates.${v}.name`)}</strong>
                <small className="ink-muted">{t(`onboarding.templates.${v}.body`)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="project-setup__invites">
          <legend>{t('onboarding.invite')}</legend>
          <div className="project-setup__invite-entry">
            <TextField
              type="email"
              label={t('onboarding.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label>
              {t('onboarding.role')}
              <select
                className="ink-input"
                value={role}
                onChange={(e) => setRole(e.target.value as ProjectRole)}
              >
                {['editor', 'commenter', 'viewer', 'owner'].map((v) => (
                  <option key={v} value={v}>
                    {t(`roles.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={addInvite} disabled={!email.trim()}>
              {t('onboarding.add')}
            </Button>
          </div>
          {email.trim() && <p className="ink-muted">{t('onboarding.pendingEmail')}</p>}
          <ul>
            {invites.map((invite) => (
              <li key={invite.email}>
                {invite.email} · {t(`roles.${invite.role}`)}{' '}
                <Button
                  variant="ghost"
                  aria-label={t('onboarding.removeNamed', { email: invite.email })}
                  onClick={() => setInvites((list) => list.filter((i) => i !== invite))}
                >
                  {t('onboarding.remove')}
                </Button>
              </li>
            ))}
          </ul>
          {!instance?.auth.email && <p className="ink-muted">{t('onboarding.noSmtp')}</p>}
        </fieldset>
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
        {!created && (
          <span className="ink-muted">
            {t('onboarding.summary', {
              boards: 1 + setupBoards(template).length,
              invitations: invites.length,
            })}
          </span>
        )}
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t('onboarding.skip')}
        </Button>
        {created ? (
          <Button variant="primary" onClick={() => onCreated(created)}>
            {t('projectsPage.open')}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !name.trim() || dateError || !!email.trim()}
          >
            {t(error && project ? 'projectsPage.retry' : 'project.create')}
          </Button>
        )}
      </DialogActions>
      {seeding !== null && project && user && (
        <ProjectSetupSeed
          key={seedBoard?.board.id ?? project.rootBoardId}
          boardId={seedBoard?.board.id ?? project.rootBoardId}
          seed={seedBoard?.seed}
          links={seedBoard ? undefined : progress.current.boards}
          userId={user.id}
          done={seedDone}
          failed={seedFailed}
        />
      )}
    </form>
  );
}
