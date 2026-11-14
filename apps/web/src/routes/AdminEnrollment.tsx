import { Button } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSignOut } from '../lib/SignOut.tsx';
import { useSession } from '../lib/session.tsx';
import { useTheme } from '../lib/theme.ts';

/** Gate all signed-in routes, including direct links to diagnostics and app authorization. */
export function AdminEnrollment({ children, setup }: { children: ReactNode; setup: ReactNode }) {
  useTheme();
  const { enrollmentRequired, user } = useSession();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const leave = useSignOut(user?.id, () => setFailed(true));
  if (!enrollmentRequired) return children;
  return (
    <main className="settings-page admin-enrollment">
      <p role="alert">{t('settings.twoFactor.requiredAdmin')}</p>
      {setup}
      <Button onClick={leave.start}>{t('auth.signOut')}</Button>
      {leave.dialog}
      {failed && <p role="alert">{t('auth.signOutFailed')}</p>}
    </main>
  );
}
