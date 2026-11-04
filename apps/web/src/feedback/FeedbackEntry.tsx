import { IconButton } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { isMac } from '../board/shortcuts.ts';
import { openFeedback, useFeedbackStatus } from './state.ts';

/** The icon beside the bell, on desktop; hidden until an administrator has chosen a destination. */
export function FeedbackEntry() {
  const { t } = useTranslation();
  const status = useFeedbackStatus();
  if (!status?.enabled) return null;
  const keys = isMac() ? '⌘⇧B' : 'Ctrl+Shift+B';
  return (
    <IconButton
      className="feedback-entry"
      icon="report"
      label={t('feedback.title')}
      data-ink-tooltip={`${t('feedback.title')} · ${keys}`}
      onClick={() => openFeedback()}
    />
  );
}
