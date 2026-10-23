import { EmptyState } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useProjects } from './AppLayout.tsx';

/** Stands in for the board canvas, which the canvas thread builds in wave 1. */
export function ProjectPlaceholder() {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 32 }}>
      <div style={{ width: 360, background: 'var(--ink-bg-panel)' }}>
        <EmptyState icon="board" title={project?.name ?? ''}>
          {t('project.boardSoon')}
        </EmptyState>
      </div>
    </div>
  );
}
