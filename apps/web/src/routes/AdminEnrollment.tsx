import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';

/** Gate all signed-in routes, including direct links to diagnostics and app authorization. */
export function AdminEnrollment({ children, setup }: { children: ReactNode; setup: ReactNode }) {
  useTheme();
  const { enrollmentRequired } = useSession();
  const { t } = useTranslation();
  if (!enrollmentRequired) return children;
  return (
    <main className="settings-page">
      <p role="alert">{t('settings.twoFactor.requiredAdmin')}</p>
      {setup}
    </main>
  );
}
