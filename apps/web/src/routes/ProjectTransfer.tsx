import {
  type Project,
  type ProjectTransfer,
  type ProjectTransfers,
  TRANSFER_FAILURES,
} from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, RequestError } from '../lib/api.ts';
import { refreshProjects } from './projects.ts';
import { formatStorage } from './StorageCharts.tsx';
import './transfer.css';
import { formatDateTime } from '../lib/datetime.ts';

const POLL_MS = 1000;
const KNOWN_FAILURES: readonly string[] = TRANSFER_FAILURES;

export const downloadUrl = (id: string) => `${API_PREFIX}/transfers/${id}/download`;
export const canExportProject = (project: Pick<Project, 'myRole'>) =>
  project.myRole === 'owner' || project.myRole === 'editor';

/** Follows a transfer until it is ready or failed. */
export function useTransfer(initial: ProjectTransfer | null) {
  const [transfer, setTransfer] = useState(initial);
  useEffect(() => setTransfer(initial), [initial]);
  const id = transfer?.id;
  const pending = transfer?.status === 'queued' || transfer?.status === 'running';
  useEffect(() => {
    if (!id || !pending) return;
    let alive = true;
    const timer = setInterval(() => {
      api
        .get<ProjectTransfer>(`/transfers/${id}`)
        .then((next) => alive && setTransfer(next))
        .catch(() => {});
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, pending]);
  return transfer;
}

function failureText(t: (key: string) => string, failure: string | null) {
  return t(
    `transfer.failure.${failure && KNOWN_FAILURES.includes(failure) ? failure : 'internal'}`,
  );
}

export function TransferProgress({
  transfer,
  label,
}: {
  transfer: ProjectTransfer;
  label: string;
}) {
  const value = Math.round(transfer.progress * 100);
  return (
    <div className="transfer-progress">
      <div className="transfer-progress__head">
        <span>{label}</span>
        <span className="transfer-progress__value">{value}%</span>
      </div>
      <div
        className="transfer-progress__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** Export project…: what goes in the archive, then progress and the download. */
export function ExportProjectDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [started, setStarted] = useState<ProjectTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transfer = useTransfer(started);
  // An export of the last day is still there: offer it at once.
  useEffect(() => {
    let alive = true;
    api
      .get<ProjectTransfers>('/transfers')
      .then(({ items }) => {
        // A ready export past its expiry is gone on the server: never offer it.
        const now = Date.now();
        const recent = items.find(
          (i) =>
            i.kind === 'export' &&
            i.projectId === project.id &&
            i.status !== 'failed' &&
            (i.expiresAt === null || Date.parse(i.expiresAt) > now),
        );
        if (alive && recent) setStarted(recent);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project.id]);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setStarted(await api.post<ProjectTransfer>(`/projects/${project.id}/exports`, {}));
    } catch (err) {
      setError(
        err instanceof RequestError && err.status === 403
          ? t('transfer.exportForbidden')
          : t('transfer.startError'),
      );
    } finally {
      setBusy(false);
    }
  };
  const pending = transfer?.status === 'queued' || transfer?.status === 'running';
  const ready = transfer?.status === 'ready';
  const time = (value: string) =>
    formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Dialog open title={t('transfer.exportTitle', { name: project.name })} onClose={onClose}>
      <div className="transfer-dialog">
        <p className="transfer-dialog__lead">{t('transfer.exportLead')}</p>
        <dl className="transfer-contents">
          <dt>{t('transfer.included')}</dt>
          <dd>{t('transfer.includedList')}</dd>
          <dt>{t('transfer.excluded')}</dt>
          <dd>{t('transfer.excludedList')}</dd>
        </dl>
        {transfer && pending && (
          <TransferProgress transfer={transfer} label={t('transfer.preparing')} />
        )}
        {transfer && ready && (
          <div className="transfer-result" role="status">
            <span className="transfer-result__title">{t('transfer.exportReady')}</span>
            <span className="transfer-result__meta">
              {[
                transfer.size !== null ? formatStorage(transfer.size, i18n.language) : null,
                transfer.expiresAt
                  ? t('transfer.availableUntil', { time: time(transfer.expiresAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}
        {transfer?.status === 'failed' && (
          <p role="alert" className="transfer-error">
            {failureText(t, transfer.failure)}
          </p>
        )}
        {error && (
          <p role="alert" className="transfer-error">
            {error}
          </p>
        )}
        {pending && <p className="transfer-dialog__note">{t('transfer.notifyNote')}</p>}
      </div>
      <DialogActions>
        <Button onClick={onClose}>{t(pending ? 'transfer.hide' : 'transfer.close')}</Button>
        {ready && transfer ? (
          <>
            <Button disabled={busy} onClick={() => void start()}>
              {t('transfer.exportAgain')}
            </Button>
            <a className="ink-btn ink-btn--primary" href={downloadUrl(transfer.id)} download>
              {t('transfer.download')}
            </a>
          </>
        ) : (
          <Button variant="primary" disabled={busy || pending} onClick={() => void start()}>
            {t(transfer?.status === 'failed' ? 'transfer.retry' : 'transfer.export')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Sends the archive with upload progress (fetch cannot report it). */
function uploadArchive(file: File, onProgress: (share: number) => void) {
  return new Promise<ProjectTransfer>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}/projects/import`);
    xhr.setRequestHeader('content-type', 'application/zip');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 202) resolve(body as ProjectTransfer);
      else reject(new RequestError(xhr.status, 'upload', xhr.statusText, body));
    };
    xhr.onerror = () => reject(new RequestError(0, 'network', 'Network error'));
    xhr.send(file);
  });
}

/** Import project…: pick an archive, upload, then follow the import to the new project. */
export function ImportProjectDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [started, setStarted] = useState<ProjectTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const transfer = useTransfer(started);
  const pick = (next: File) => {
    setError(null);
    if (!/\.zip$/i.test(next.name)) {
      setFile(null);
      setError(t('transfer.notZip'));
      return;
    }
    setFile(next);
  };
  const refreshed = useRef(false);
  useEffect(() => {
    if (transfer?.status === 'ready' && !refreshed.current) {
      refreshed.current = true;
      void refreshProjects();
    }
  }, [transfer?.status]);
  const start = useCallback(async () => {
    if (!file) return;
    setError(null);
    setUploading(0);
    try {
      setStarted(await uploadArchive(file, setUploading));
    } catch (err) {
      const status = err instanceof RequestError ? err.status : 0;
      setError(
        t(
          status === 413
            ? 'transfer.failure.too_large'
            : status === 409
              ? 'transfer.busy'
              : 'transfer.uploadError',
        ),
      );
    } finally {
      setUploading(null);
    }
  }, [file, t]);
  const pending = transfer?.status === 'queued' || transfer?.status === 'running';
  const busy = uploading !== null || pending;
  const summary = transfer?.status === 'ready' ? transfer.summary : null;
  return (
    <Dialog
      open
      title={t('transfer.importTitle')}
      onClose={onClose}
      onCancel={(e) => {
        if (uploading !== null) e.preventDefault();
      }}
    >
      <div className="transfer-dialog">
        <p className="transfer-dialog__lead">{t('transfer.importLead')}</p>
        {!transfer && (
          <label
            className={`transfer-drop ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => {
              if (busy) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (!busy && dropped) pick(dropped);
            }}
          >
            <input
              className="transfer-drop__input"
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) pick(picked);
              }}
            />
            {file ? (
              <>
                <span className="transfer-drop__title">{file.name}</span>
                <span className="transfer-drop__meta">
                  {formatStorage(file.size, i18n.language)} · {t('transfer.change')}
                </span>
              </>
            ) : (
              <>
                <span className="transfer-drop__title">{t('transfer.drop')}</span>
                <span className="transfer-drop__meta">{t('transfer.dropHint')}</span>
              </>
            )}
          </label>
        )}
        {uploading !== null && (
          <TransferProgress
            transfer={{ progress: uploading } as ProjectTransfer}
            label={t('transfer.uploading')}
          />
        )}
        {transfer && pending && (
          <TransferProgress transfer={transfer} label={t('transfer.importing')} />
        )}
        {summary && transfer && (
          <div className="transfer-result" role="status">
            <span className="transfer-result__title">
              {t('transfer.importReady', { name: transfer.projectName })}
            </span>
            <span className="transfer-result__meta">
              {t('transfer.summary', {
                boards: summary.boards,
                files: summary.files,
                comments: summary.comments,
              })}
            </span>
            {summary.remappedPeople > 0 && (
              <span className="transfer-result__meta">
                {t('transfer.remappedPeople', { count: summary.remappedPeople })}
              </span>
            )}
            {summary.skippedFiles > 0 && (
              <span className="transfer-result__warn">
                {t('transfer.skippedFiles', { count: summary.skippedFiles })}
              </span>
            )}
          </div>
        )}
        {transfer?.status === 'failed' && (
          <p role="alert" className="transfer-error">
            {failureText(t, transfer.failure)}
          </p>
        )}
        {error && (
          <p role="alert" className="transfer-error">
            {error}
          </p>
        )}
        {pending && <p className="transfer-dialog__note">{t('transfer.notifyNote')}</p>}
      </div>
      <DialogActions>
        <Button disabled={uploading !== null} onClick={onClose}>
          {t(pending ? 'transfer.hide' : 'transfer.close')}
        </Button>
        {transfer?.status === 'ready' && transfer.projectId ? (
          <Link
            className="ink-btn ink-btn--primary"
            to={`/p/${transfer.projectId}`}
            onClick={onClose}
          >
            {t('transfer.openProject')}
          </Link>
        ) : transfer?.status === 'failed' ? (
          <Button
            variant="primary"
            onClick={() => {
              setStarted(null);
              setFile(null);
            }}
          >
            {t('transfer.chooseAnother')}
          </Button>
        ) : (
          <Button variant="primary" disabled={!file || busy} onClick={() => void start()}>
            {t('transfer.import')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
