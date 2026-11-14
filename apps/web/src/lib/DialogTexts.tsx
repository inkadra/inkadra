import { DateFieldTextsContext, DialogTextsContext, TimeFieldTextsContext } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { uses12h } from './datetime.ts';
import { usePreferences } from './preferences.ts';

/**
 * The words the shared components need in the language of the app: the "Discard changes?"
 * question of the dialogs, the date field's calendar and the time field, with the person's
 * clock (12 or 24 h, #302).
 */
export function DialogTexts({ children }: { children: ReactNode }) {
  // Re-renders on a change of language too, and the page's lang follows it (i18n/index.ts).
  const { t } = useTranslation();
  const prefs = usePreferences();
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
        <TimeFieldTextsContext.Provider
          value={{
            hours: t('timeField.hours'),
            minutes: t('timeField.minutes'),
            period: t('timeField.period'),
            choose: t('timeField.choose'),
            clear: t('dateField.clear'),
            now: t('timeField.now'),
            required: t('timeField.required'),
            hour12: uses12h(prefs),
          }}
        >
          {children}
        </TimeFieldTextsContext.Provider>
      </DateFieldTextsContext.Provider>
    </DialogTextsContext.Provider>
  );
}
