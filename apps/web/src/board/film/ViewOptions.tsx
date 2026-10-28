import { Button, Dialog, DialogActions, IconButton } from '@inkadra/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './film-phone.css';

/**
 * On a phone a view's secondary controls fold behind one button into a bottom sheet; on wider
 * screens the button stays hidden and the controls stay in the bar (film-phone.css).
 */
export function ViewOptions({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon="more"
        label={t('film.viewOptions.title')}
        className="view-options__toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      {open && (
        <div className="phone-sheet">
          <Dialog open title={t('film.viewOptions.title')} onClose={() => setOpen(false)}>
            <div className="view-options">{children}</div>
            <DialogActions>
              <Button variant="primary" onClick={() => setOpen(false)}>
                {t('film.viewOptions.done')}
              </Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
    </>
  );
}
