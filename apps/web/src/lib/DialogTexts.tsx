import { DialogTextsContext } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The words of the "Discard changes?" question of the dialogs, in the language of the app. */
export function DialogTexts({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <DialogTextsContext.Provider
      value={{
        title: t('dialog.discardTitle'),
        discard: t('dialog.discard'),
        keep: t('dialog.keep'),
      }}
    >
      {children}
    </DialogTextsContext.Provider>
  );
}
