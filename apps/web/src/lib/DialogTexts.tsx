import { DateFieldTextsContext, DialogTextsContext } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The words the shared components need in the language of the app: the "Discard changes?"
 * question of the dialogs and the date field's calendar.
 */
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
      <DateFieldTextsContext.Provider
        value={{
          clear: t('dateField.clear'),
          today: t('dateField.today'),
          previousMonth: t('dateField.previousMonth'),
          nextMonth: t('dateField.nextMonth'),
          previousYear: t('dateField.previousYear'),
          nextYear: t('dateField.nextYear'),
        }}
      >
        {children}
      </DateFieldTextsContext.Provider>
    </DialogTextsContext.Provider>
  );
}
