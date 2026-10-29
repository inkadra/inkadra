import { Button } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';
import { setCachedProjects } from './projects.ts';

/** Gate all signed-in routes, including direct links to diagnostics and app authorization. */
export function AdminEnrollment({ children, setup }: { children: ReactNode; setup: ReactNode }) {
  useTheme();
  const { enrollmentRequired, refresh } = useSession();
  const { t } = useTranslation();
  if (!enrollmentRequired) return children;
  return (
    <main className="settings-page">
      <p role="alert">{t('settings.twoFactor.requiredAdmin')}</p>
      {setup}
      <Button
        onClick={async () => {
          await authApi.signOut();
          setCachedProjects(null);
          await refresh();
        }}
      >
        {t('auth.signOut')}
      </Button>
    </main>
  );
}
