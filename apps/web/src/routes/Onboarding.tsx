import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useInstanceSetupState, useProjects } from './AppLayout.tsx';
import { InstanceChecklist } from './InstanceSetup.tsx';
import { ProjectSetupForm } from './NewProjectDialog.tsx';
import { onboardingTitle } from './project-setup.ts';
import { refreshProjects } from './projects.ts';

export function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setup = useInstanceSetupState();
  // The same form as New project: only a first project gets the welcome title.
  const { projects } = useProjects();
  const title = onboardingTitle(projects);
  const first = title === 'onboarding.firstTitle';
  return (
    <div className="onboarding-page">
      <section className="ink-card onboarding-page__form">
        {/* Empty while loading, so a first-time user never sees the other title first. */}
        <h1>{title && t(title)}</h1>
        <p className="ink-muted">
          {title && t(first ? 'onboarding.firstSubtitle' : 'onboarding.subtitle')}
        </p>
        <ProjectSetupForm
          onClose={() => navigate('/projects')}
          onCreated={async (p) => {
            await refreshProjects();
            navigate(`/p/${p.id}`);
          }}
        />
      </section>
      <aside>
        <InstanceChecklist {...setup} />
        <section className="ink-card instance-checklist">
          <h2>{t('onboarding.tipsTitle')}</h2>
          <ul>
            <li>{t('onboarding.tips.search')}</li>
            <li>{t('onboarding.tips.drag')}</li>
            <li>{t('onboarding.tips.phone')}</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
