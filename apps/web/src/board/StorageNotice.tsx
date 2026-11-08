import type { MyStorage, StorageFull } from '@inkadra/shared';
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { formatStorage } from '../routes/StorageCharts.tsx';
import { LargestFilesDialog, spaceTone } from '../routes/StorageSpace.tsx';
import { Toast } from './chrome.tsx';
import { batchCount, dismissRefused, type UploadItem, useUploads } from './uploads.ts';

/** Batches already told, across every upload panel of the page. */
const told = new Set<number>();
/** The warning near the limit comes once per page, not after every upload. */
let warned = false;

type Notice =
  | { kind: 'refused'; batch: number; files: UploadItem[]; refused: StorageFull; total: number }
  | { kind: 'near'; used: number; limit: number };

const settled = (i: UploadItem) => i.state !== 'uploading' && i.state !== 'offline';

/**
 * Space refusals of the uploads (decision 0081): one file refused is a toast, more a dialog
 * with those that did not fit. After uploads that went through, a warning near the limit.
 */
export function StorageNotice() {
  const uploads = useUploads();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (notice) return;
    const batches = new Set(uploads.map((u) => u.batch));
    for (const id of batches) {
      if (told.has(id)) continue;
      const items = uploads.filter((u) => u.batch === id);
      if (!items.every(settled)) continue;
      const full = items.filter((u) => u.state === 'full');
      const counts = batchCount(id);
      // The instance first, else the tightest: what the person can still do.
      const refusals = full
        .flatMap((u) => (u.refused ? [u.refused] : []))
        .sort((a, b) =>
          a.scope === b.scope ? a.remaining - b.remaining : a.scope === 'instance' ? -1 : 1,
        );
      const refused = refusals[0];
      if (refused) {
        told.add(id);
        setNotice({ kind: 'refused', batch: id, files: full, refused, total: counts.total });
        return;
      }
      if (counts.done > 0 && !warned) {
        told.add(id);
        warned = true;
        api
          .get<MyStorage>('/me/storage')
          .then((space) => {
            const used = space.originalBytes + space.derivedBytes;
            if (space.limit !== null && spaceTone(used, space.limit, space.warnPercent) === 'warn')
              setNotice({ kind: 'near', used, limit: space.limit });
          })
          .catch(() => {});
      }
    }
  }, [uploads, notice]);

  if (!notice) return null;
  return (
    <NoticeView
      notice={notice}
      onClose={() => {
        if (notice.kind === 'refused') dismissRefused(notice.batch);
        setNotice(null);
      }}
    />
  );
}

/** What StorageNotice shows; mounted only with something to say, inside the app. */
function NoticeView({ notice, onClose: close }: { notice: Notice; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const [details, setDetails] = useState(notice.kind === 'refused' && notice.total > 1);
  const [files, setFiles] = useState(false);
  const [asked, setAsked] = useState<'sent' | 'already' | null>(null);
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  if (notice.kind === 'near')
    return (
      <Toast
        warning="warn"
        text={t('storageSpace.nearToast', {
          percent: Math.round((notice.used / notice.limit) * 100),
          size: size(Math.max(0, notice.limit - notice.used)),
        })}
        showLabel={t('storageSpace.see')}
        onShow={() => {
          close();
          navigate('/settings?section=account');
        }}
        onClose={close}
      />
    );

  const { refused, files: refusedFiles, total } = notice;
  const instance = refused.scope === 'instance';
  const single = refusedFiles[0];
  return (
    <>
      {!details && (
        <Toast
          warning="danger"
          text={
            instance
              ? t('storageSpace.instanceToast')
              : t('storageSpace.fileToast', { name: single?.name ?? '' })
          }
          showLabel={t('storageSpace.details')}
          onShow={() => setDetails(true)}
          onClose={close}
        />
      )}
      <Dialog open={details} title={t('storageSpace.blockedTitle')} onClose={close}>
        <p className="settings-muted">
          {instance
            ? t('storageSpace.instanceLeft', { size: size(refused.remaining) })
            : t('storageSpace.leftOf', {
                size: size(refused.remaining),
                limit: size(refused.limit),
              })}{' '}
          {t('storageSpace.uploadedOf', {
            count: refusedFiles.length,
            done: Math.max(0, total - refusedFiles.length),
            total,
          })}
        </p>
        <div className="space-files">
          <table>
            <thead className="ink-sr-only">
              <tr>
                <th scope="col">{t('storageSpace.file')}</th>
                <th scope="col">{t('admin.storageCharts.size')}</th>
              </tr>
            </thead>
            <tbody>
              {refusedFiles.map((f) => (
                <tr key={f.key}>
                  <th scope="row">
                    <span className="space-files__name">{f.name}</span>
                  </th>
                  <td>{size(f.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="settings-muted">
            {t(instance ? 'storageSpace.instanceHelp' : 'storageSpace.blockedHelp')}
          </p>
          {asked && (
            <p role="status" className="settings-muted">
              {t(asked === 'sent' ? 'storageSpace.asked' : 'storageSpace.alreadyAsked')}
            </p>
          )}
        </div>
        <DialogActions>
          <Button variant="ghost" onClick={close}>
            {t('storageSpace.close')}
          </Button>
          {user?.role !== 'admin' && (
            <Button
              icon="people"
              disabled={asked !== null}
              onClick={() =>
                void api
                  .post<{ sent: boolean }>('/me/storage/request', {})
                  .then((r) => setAsked(r.sent ? 'sent' : 'already'))
                  .catch(() => setAsked('already'))
              }
            >
              {t('storageSpace.ask')}
            </Button>
          )}
          {!instance && (
            <Button variant="primary" onClick={() => setFiles(true)}>
              {t('storageSpace.largest')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <LargestFilesDialog
        open={files}
        path="/me/storage/files"
        title={t('storageSpace.largestTitle')}
        onClose={() => setFiles(false)}
      />
    </>
  );
}
