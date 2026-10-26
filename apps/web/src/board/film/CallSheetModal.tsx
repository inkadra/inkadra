// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Dialog } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import './film.css';

export interface CallSheetModalProps {
  day?: number;
  projectName?: string;
  onClose: () => void;
}
export function CallSheetModal({ projectName, onClose }: CallSheetModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog open title={t('shells.callSheet')} onClose={onClose}>
      <div className="film-shell__print">
        <strong>{t('shells.demo')}</strong>
        <h3>{projectName}</h3>
        <p>{t('shells.callSheetUnavailable')}</p>
      </div>
      <Button onClick={onClose}>{t('shells.close')}</Button>
      <Button disabled>{t('shells.print')}</Button>
    </Dialog>
  );
}
