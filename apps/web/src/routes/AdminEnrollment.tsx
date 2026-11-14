import { Button } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../lib/session.tsx';
import { signOut } from '../lib/sign-out.ts';
import { useTheme } from '../lib/theme.ts';

/** Gate all signed-in routes, including direct links to diagnostics and app authorization. */
export function AdminEnrollment({ children, setup }: { children: ReactNode; setup: ReactNode }) {
  useTheme();
  const { enrollmentRequired, user } = useSession();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (!enrollmentRequired) return children;
  return (
    <main className="settings-page admin-enrollment">
      <p role="alert">{t('settings.twoFactor.requiredAdmin')}</p>
      {setup}
      <Button onClick={() => signOut(user?.id).catch(() => setFailed(true))}>
        {t('auth.signOut')}
      </Button>
      {failed && <p role="alert">{t('auth.signOutFailed')}</p>}
    </main>
  );
}
