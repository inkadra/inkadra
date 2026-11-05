import {
  type CreateFeedback,
  FEEDBACK_FILE_BYTES,
  FEEDBACK_RELAY_FILE_BYTES,
  FEEDBACK_RELAY_TOTAL_BYTES,
  FEEDBACK_RELAY_VIDEO_BYTES,
  FEEDBACK_VIDEO_BYTES,
  type FeedbackAttachment,
  type FeedbackReceipt,
  type FeedbackStatus,
} from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  type DialogHandle,
  Icon,
  IconButton,
  KeyCap,
  Segmented,
  TextField,
} from '@inkadra/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isMac } from '../board/shortcuts.ts';
import { api, RequestError } from '../lib/api.ts';
import { useIsPhone } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';
import { formatStorage } from '../routes/StorageCharts.tsx';
import { diagnostics } from './diagnostics.ts';
import { ScreenshotEditor } from './ScreenshotEditor.tsx';
import {
  type FeedbackPrefill,
  isFeedbackKey,
  leftOutOfScreenshot,
  onOpenFeedback,
  readFeedbackDraft,
  reportArea,
  STATUS_CHANGED,
  setFeedbackStatus,
  useFeedbackStatus,
} from './state.ts';
import './feedback.css';

type Kind = FeedbackAttachment['kind'];
type LocalAttachment = {
  key: string;
  kind: Kind;
  name: string;
  blob: Blob;
  url: string;
  error?: string;
  uploaded?: FeedbackAttachment;
  seconds?: number;
  redactedAreas?: number;
  /** Made in this dialog: no metadata from a device to take off. */
  recorded?: boolean;
};
type Phase = 'compose' | 'preview' | 'recordIntro' | 'videoReview' | 'done' | 'off';
type Failure = {
  kind: 'failed' | 'interrupted' | 'limited' | 'refused' | 'destination';
  detail?: string;
};
const PARTS = ['environment', 'page', 'console', 'network', 'sync', 'flags'] as const;
type Part = (typeof PARTS)[number];
const GUEST_PARTS: Part[] = ['environment', 'page'];
const GUEST_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const RECORD_SECONDS = 60;
const CAPTURE_TIMEOUT_MS = 15000;
const ACCEPTED = /^(image|video|text)\/|^application\/(pdf|json)$/;
const ACCEPTED_NAME = /\.(log|txt|md|json|csv|pdf|heic|heif|mov|mp4|webm|png|jpe?g|webp)$/i;
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function defaultParts(type: CreateFeedback['type'], guest: boolean): Part[] {
  if (guest) return GUEST_PARTS;
  return type === 'bug' ? PARTS.filter((p) => p !== 'network') : ['environment'];
}

function Banner({
  tone,
  icon,
  role = 'status',
  children,
}: {
  tone: 'danger' | 'warn' | 'ok' | 'info';
  icon: 'warning' | 'clock' | 'check' | 'film';
  role?: 'status' | 'alert' | 'note';
  children: ReactNode;
}) {
  return (
    <div className={`feedback-banner feedback-banner--${tone}`} role={role}>
      <Icon name={icon} size={14} />
      <div>{children}</div>
    </div>
  );
}

/** Marks what redaction took out, in the text exactly as it leaves. */
function RedactedText({ text }: { text: string }) {
  let offset = 0;
  return text.split(/(\[(?:redacted[^\]]*|id)\])/gi).map((part) => {
    offset += part.length;
    return /^\[(?:redacted|id)/i.test(part) ? <mark key={offset}>{part}</mark> : part;
  });
}

export function FeedbackKeys() {
  const keys = isMac() ? ['⌘', '⇧', 'B'] : ['Ctrl', '⇧', 'B'];
  return (
    <span className="feedback-keys" aria-hidden="true">
      {keys.map((key) => (
        <KeyCap key={key}>{key}</KeyCap>
      ))}
    </span>
  );
}

/** Mounted once per page. Opens from the shortcut and from `openFeedback`; has no entry of its own. */
export function FeedbackLauncher({ linkId }: { linkId?: string }) {
  const { t, i18n } = useTranslation();
  const { user, version } = useSession();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const guest = !!linkId;
  const canRecord =
    !guest &&
    !phone &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  const prefix = linkId ? `/guest/links/${linkId}/feedback` : '/feedback';
  const status = useFeedbackStatus();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('compose');
  const [type, setType] = useState<CreateFeedback['type']>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [guestName, setGuestName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [prefill, setPrefill] = useState<FeedbackPrefill | null>(null);
  const [files, setFiles] = useState<LocalAttachment[]>([]);
  const [shot, setShot] = useState<LocalAttachment | null>(null);
  const [shotIncluded, setShotIncluded] = useState(true);
  // Only the automatic capture leaves the names out: a shared tab or a pasted image shows it all.
  const [shotAutomatic, setShotAutomatic] = useState(false);
  const relay = status?.destination === 'relay';
  const videoLimit = relay ? FEEDBACK_RELAY_VIDEO_BYTES : FEEDBACK_VIDEO_BYTES;
  const fileLimit = relay ? FEEDBACK_RELAY_FILE_BYTES : FEEDBACK_FILE_BYTES;
  const [video, setVideo] = useState<LocalAttachment | null>(null);
  const [candidate, setCandidate] = useState<LocalAttachment | null>(null);
  const [data, setData] = useState<ReturnType<typeof diagnostics> | null>(null);
  const [selected, setSelected] = useState<Part[]>(() => defaultParts('bug', guest));
  const [capturing, setCapturing] = useState<'idle' | 'loading' | 'error'>('idle');
  const [editing, setEditing] = useState<'draw' | 'redact' | null>(null);
  const [capturePill, setCapturePill] = useState(false);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(RECORD_SECONDS);
  const [permission, setPermission] = useState(false);
  const [wholeScreen, setWholeScreen] = useState(false);
  const [recordHint, setRecordHint] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    kind: Kind;
    name: string;
    loaded: number;
    total: number;
  } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [backOnline, setBackOnline] = useState(false);
  const [receipt, setReceipt] = useState<FeedbackReceipt | null>(null);
  const [fetchedVersion, setFetchedVersion] = useState<string>();

  const requestId = useRef<string>(crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const titleBox = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<DialogHandle>(null);
  const content = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const discardRecording = useRef(false);
  const dragDepth = useRef(0);
  const captureRun = useRef(0);
  const waiting = useRef<FeedbackPrefill | null>(null);

  const draftKey = `inkadra.feedback.draft:${linkId ?? user?.id ?? 'anonymous'}`;
  const focusTitle = useCallback(() => titleBox.current?.querySelector('input')?.focus(), []);

  const local = (blob: Blob, kind: Kind, name: string): LocalAttachment => ({
    key: crypto.randomUUID(),
    blob,
    kind,
    name,
    url: URL.createObjectURL(blob),
  });
  const drop = (item: LocalAttachment | null) => {
    if (item) URL.revokeObjectURL(item.url);
  };

  const refresh = useCallback(() => {
    void api
      .get<FeedbackStatus>(`${prefix}/status`)
      .then(setFeedbackStatus)
      .catch(() => setFeedbackStatus(null));
  }, [prefix]);
  useEffect(() => {
    refresh();
    window.addEventListener(STATUS_CHANGED, refresh);
    return () => {
      window.removeEventListener(STATUS_CHANGED, refresh);
      setFeedbackStatus(null);
    };
  }, [refresh]);

  // Text stays on this device until it is sent or discarded (decision 9).
  const loadedDraft = useRef('');
  useEffect(() => {
    const draft = readFeedbackDraft(draftKey);
    if (draft) {
      setTitle(draft.title ?? '');
      setDescription(draft.description ?? '');
      if (draft.requestId) requestId.current = draft.requestId;
      if (draft.type) {
        setType(draft.type);
        setSelected(defaultParts(draft.type, guest));
        setShotIncluded(draft.type === 'bug');
      }
    }
    loadedDraft.current = draftKey;
  }, [draftKey, guest]);
  useEffect(() => {
    if (loadedDraft.current !== draftKey) return;
    try {
      if (title || description)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ title, description, type, requestId: requestId.current }),
        );
      else localStorage.removeItem(draftKey);
    } catch {
      /* The text is still in memory. */
    }
  }, [draftKey, title, description, type]);

  useEffect(() => {
    const update = () => {
      setBackOnline(navigator.onLine);
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(
    () => () => {
      for (const track of stream.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: every step starts at the top
  useEffect(() => {
    const el = content.current?.closest('dialog');
    if (el) el.scrollTop = 0;
  }, [phase]);
  useEffect(() => {
    if (open && phase === 'compose') focusTitle();
  }, [open, phase, focusTitle]);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setTimeout(() => setRetryAt(0), retryAt - Date.now());
    return () => clearTimeout(timer);
  }, [retryAt]);

  function reset() {
    drop(shot);
    drop(video);
    drop(candidate);
    for (const file of files) drop(file);
    setShot(null);
    setVideo(null);
    setCandidate(null);
    setFiles([]);
    setTitle('');
    setDescription('');
    setGuestName('');
    setType('bug');
    setShotIncluded(true);
    setSelected(defaultParts('bug', guest));
    setAttempted(false);
    setPrefill(null);
    setFailure(null);
    setReceipt(null);
    setPhase('compose');
    setRecordHint(false);
    setPermission(false);
    requestId.current = crypto.randomUUID();
  }

  async function capture() {
    const run = ++captureRun.current;
    setCapturing('loading');
    // The copy takes its styles from the page while this is on: see feedback.css.
    document.documentElement.dataset.feedbackCapturing = '';
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await Promise.race([
        toBlob(document.body, {
          width: innerWidth,
          height: innerHeight,
          // Guests have a smaller size limit.
          pixelRatio: guest ? 1 : Math.min(devicePixelRatio, 2),
          imagePlaceholder: TRANSPARENT,
          filter: (node) => !leftOutOfScreenshot(node),
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)),
      ]);
      if (run !== captureRun.current) return;
      if (!blob) throw new Error('Capture failed');
      setShot((old) => {
        drop(old);
        return local(blob, 'screenshot', 'screenshot.png');
      });
      setShotAutomatic(true);
      setShotIncluded(true);
      setCapturing('idle');
    } catch {
      if (run === captureRun.current) setCapturing('error');
    } finally {
      if (run === captureRun.current) delete document.documentElement.dataset.feedbackCapturing;
    }
  }

  /** Hands the app back for recording or capture: the Settings window would keep it inert. */
  function minimize() {
    setOpen(false);
    for (const other of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
      if (!other.closest('[data-feedback-exclude]')) other.close();
  }

  function launch(next?: FeedbackPrefill) {
    if (!status) {
      // Pressed while the status is still on its way: answered as soon as it arrives.
      waiting.current = next ?? {};
      return;
    }
    if (!status.enabled) {
      if (guest) return;
      setPhase('off');
      setOpen(true);
      return;
    }
    if (next) {
      setPrefill(next);
      if (next.title && !title) setTitle(next.title);
    }
    setPhase('compose');
    setOpen(true);
    if (!version && !guest && !fetchedVersion)
      void api
        .get<{ version: string }>('/instance/version')
        .then((r) => setFetchedVersion(r.version))
        .catch(() => {});
    if (type === 'bug' && !shot) void capture();
  }
  const launchRef = useRef(launch);
  launchRef.current = launch;
  useEffect(() => {
    if (!status || !waiting.current) return;
    const next = waiting.current;
    waiting.current = null;
    launchRef.current(next);
  }, [status]);
  const openRef = useRef(false);
  openRef.current = open || capturePill || recording;

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (!isFeedbackKey(e)) return;
      // Reporting owns this chord in every field, and the browser's bookmarks bar stays shut.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (openRef.current) focusTitle();
      else launchRef.current();
    }
    window.addEventListener('keydown', key, true);
    const off = onOpenFeedback((next) => {
      if (!openRef.current) launchRef.current(next);
    });
    return () => {
      window.removeEventListener('keydown', key, true);
      off();
    };
  }, [focusTitle]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const left = Math.max(0, RECORD_SECONDS - Math.floor((Date.now() - started) / 1000));
      setRemaining(left);
      if (left === 0 && recorder.current?.state === 'recording') recorder.current.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  async function record() {
    setPermission(false);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);
    } catch {
      setPermission(true);
      return;
    }
    stream.current = media;
    for (const track of media.getAudioTracks()) {
      track.stop();
      media.removeTrack(track);
    }
    // Browsers that do not say what was shared get the general warning in the review only.
    const surface = (media.getVideoTracks()[0]?.getSettings() as { displaySurface?: string })
      ?.displaySurface;
    setWholeScreen(surface === 'monitor' || surface === 'window');
    const rec = new MediaRecorder(media, { videoBitsPerSecond: 2_500_000 });
    recorder.current = rec;
    const chunks: Blob[] = [];
    let size = 0;
    const started = Date.now();
    rec.ondataavailable = (e) => {
      size += e.data.size;
      if (size <= videoLimit) chunks.push(e.data);
      else if (rec.state === 'recording') rec.stop();
    };
    discardRecording.current = false;
    rec.onstop = () => {
      for (const track of media.getTracks()) track.stop();
      setRecording(false);
      if (discardRecording.current || !chunks.length) {
        setPhase('compose');
        setOpen(true);
        return;
      }
      const mime = rec.mimeType || 'video/webm';
      const item = local(
        new Blob(chunks, { type: mime }),
        'video',
        `recording.${mime.includes('mp4') ? 'mp4' : 'webm'}`,
      );
      item.seconds = Math.min(RECORD_SECONDS, Math.round((Date.now() - started) / 1000));
      item.recorded = true;
      setCandidate(item);
      setPhase('videoReview');
      setOpen(true);
    };
    rec.start(250);
    setRemaining(RECORD_SECONDS);
    setRecording(true);
    minimize();
  }

  function addFiles(list: FileList | File[], asScreenshot = false) {
    const picked = Array.from(list);
    if (asScreenshot) {
      const file = picked[0];
      if (!file) return;
      if (file.size > (guest ? GUEST_SCREENSHOT_BYTES : FEEDBACK_FILE_BYTES)) {
        setCapturing('error');
        return;
      }
      setShot((old) => {
        drop(old);
        return local(file, 'screenshot', file.name);
      });
      setShotAutomatic(false);
      setShotIncluded(true);
      setCapturing('idle');
      return;
    }
    let count = files.filter((f) => !f.error).length;
    const rows: LocalAttachment[] = [];
    let reviewed = false;
    for (const file of picked) {
      const isVideo = file.type.startsWith('video/') || /\.(mov|mp4|webm)$/i.test(file.name);
      const item = local(file, isVideo ? 'video' : 'file', file.name);
      if (!ACCEPTED.test(file.type) && !ACCEPTED_NAME.test(file.name))
        item.error = t('feedback.typeRefused');
      else if (isVideo && status?.deviceVideos === false)
        item.error = t('feedback.relayNoDeviceVideo');
      else if (isVideo && file.size > videoLimit)
        item.error = t(relay ? 'feedback.relayVideoTooBig' : 'feedback.videoTooBig', {
          size: formatStorage(file.size, i18n.language),
        });
      else if (!isVideo && file.size > fileLimit)
        item.error = t(relay ? 'feedback.relayFileTooBig' : 'feedback.fileTooBig', {
          size: formatStorage(file.size, i18n.language),
        });
      else if (isVideo && (video || reviewed)) item.error = t('feedback.oneVideo');
      else if (!isVideo && count >= 5) item.error = t('feedback.tooMany');
      if (isVideo && !item.error) {
        reviewed = true;
        setWholeScreen(false);
        setCandidate(item);
        setPhase('videoReview');
      } else {
        if (!item.error) count++;
        rows.push(item);
      }
    }
    setFiles((old) => [...old, ...rows]);
  }

  function changeType(value: CreateFeedback['type']) {
    setType(value);
    setSelected(defaultParts(value, guest));
    // The picture stays in memory: going back to Bug brings back the same one, redactions included.
    setShotIncluded(value === 'bug');
    if (value === 'bug' && !shot && capturing !== 'loading') void capture();
  }

  function toPreview() {
    setAttempted(true);
    if (!title.trim()) {
      focusTitle();
      return;
    }
    if (relayOver) return;
    setData(diagnostics(version ?? fetchedVersion ?? 'unknown', i18n.language, prefill?.details));
    setFailure(null);
    setPhase('preview');
  }

  function upload(item: LocalAttachment, signal: AbortSignal) {
    return new Promise<FeedbackAttachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'POST',
        `${API_PREFIX}${prefix}/attachments?${new URLSearchParams({
          kind: item.kind,
          name: item.name.slice(0, 180),
          ...(item.recorded ? { recorded: '1' } : {}),
        })}`,
      );
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = (e) =>
        setProgress({
          kind: item.kind,
          name: item.name,
          loaded: e.loaded,
          total: e.lengthComputable ? e.total : item.blob.size,
        });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as FeedbackAttachment);
          } catch {
            reject(new RequestError(xhr.status, 'unknown', 'Invalid response'));
          }
        } else
          reject(
            new RequestError(
              xhr.status,
              'unknown',
              'Upload failed',
              Number(xhr.getResponseHeader('retry-after')),
            ),
          );
      };
      xhr.onerror = () => reject(new RequestError(0, 'network', 'Upload failed'));
      xhr.onabort = () => reject(new DOMException('Interrupted', 'AbortError'));
      const cancel = () => xhr.abort();
      signal.addEventListener('abort', cancel, { once: true });
      xhr.onloadend = () => signal.removeEventListener('abort', cancel);
      setProgress({ kind: item.kind, name: item.name, loaded: 0, total: item.blob.size });
      xhr.send(item.blob);
    });
  }

  const sent = (): LocalAttachment[] => [
    ...(shot && shotIncluded ? [shot] : []),
    ...(video ? [video] : []),
    ...files.filter((f) => !f.error),
  ];
  const relayOver =
    relay && sent().reduce((n, a) => n + a.blob.size, 0) > FEEDBACK_RELAY_TOTAL_BYTES;

  async function send() {
    if (busy || !data) return;
    setBusy(true);
    setBackOnline(false);
    setFailure(null);
    const controller = new AbortController();
    abort.current = controller;
    let current: LocalAttachment | null = null;
    try {
      const uploaded: FeedbackAttachment[] = [];
      for (const item of sent()) {
        current = item;
        item.uploaded ??= await upload(item, controller.signal);
        uploaded.push({
          ...item.uploaded,
          ...(item.seconds === undefined ? {} : { seconds: item.seconds }),
          ...(item.redactedAreas ? { redactedAreas: item.redactedAreas } : {}),
        });
      }
      current = null;
      const area = guest ? 'guest' : reportArea(location.pathname);
      const payload: CreateFeedback = {
        requestId: requestId.current,
        type,
        area,
        title,
        description,
        ...(guest && guestName.trim() ? { guestName } : {}),
        diagnostics: Object.fromEntries(
          Object.entries(data).filter(([key, value]) => value && selected.includes(key as Part)),
        ),
        attachments: uploaded,
        ...(status?.destination ? { expectedDestination: status.destination } : {}),
      };
      const response = await fetch(`${API_PREFIX}${prefix}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Files uploaded for another destination are not made safe for this one: they go up again.
      if (response.status === 400 || response.status === 409)
        for (const item of sent()) item.uploaded = undefined;
      if (response.status === 409) {
        refresh();
        setFailure({ kind: 'destination' });
        return;
      }
      if (!response.ok)
        throw new RequestError(
          response.status,
          'unknown',
          'Send failed',
          Number(response.headers.get('retry-after')),
        );
      setReceipt((await response.json()) as FeedbackReceipt);
      setPhase('done');
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* The draft goes on closing anyway. */
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setFailure({ kind: 'interrupted' });
      else if (e instanceof RequestError && e.status === 429) {
        const seconds = typeof e.details === 'number' && e.details > 0 ? e.details : 600;
        setRetryAt(Date.now() + seconds * 1000);
        setFailure({ kind: 'limited', detail: String(Math.ceil(seconds / 60)) });
      } else if (e instanceof RequestError && e.status === 400 && current) {
        // The server read the real type: this file does not leave, the rest can.
        const refused = current;
        if (refused.kind === 'screenshot') setShotIncluded(false);
        else if (refused.kind === 'video') setVideo(null);
        refused.error = t('feedback.typeRefused');
        if (refused.kind !== 'screenshot')
          setFiles((old) => (old.includes(refused) ? [...old] : [...old, refused]));
        setFailure({ kind: 'refused', detail: refused.name });
      } else
        setFailure({
          kind: 'failed',
          detail: e instanceof RequestError && e.status ? String(e.status) : undefined,
        });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const redactedAreas = shot?.redactedAreas ?? 0;
  const parts = guest ? GUEST_PARTS : PARTS;
  const dirty =
    phase !== 'done' &&
    phase !== 'off' &&
    (!!title || !!description || !!video || files.length > 0 || redactedAreas > 0);
  const size = (bytes: number) => formatStorage(bytes, i18n.language);
  const typeTag = (
    <div className="feedback-head">
      <span className={`feedback-tag feedback-tag--${type}`}>{t(`feedback.types.${type}`)}</span>
      <span className="feedback-head__title">{title}</span>
    </div>
  );
  const privacy = (
    <p className="feedback-privacy">
      <Icon name="lock" size={14} />
      <span>
        {guest
          ? t(relay ? 'feedback.privacyRelay' : 'feedback.privacyGuest')
          : t(
              relay
                ? 'feedback.privacyRelay'
                : status?.destination === 'inbox'
                  ? 'feedback.privacyInbox'
                  : 'feedback.privacy',
              {
                days: status?.retentionDays ?? 90,
              },
            )}
        {!relay && ` ${t('feedback.linkPrivacy')}`}
      </span>
    </p>
  );

  function partChoice(part: Part) {
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox renders the native input
      <label
        className="feedback-choice"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
        }}
      >
        <Checkbox
          checked={selected.includes(part)}
          onChange={(e) =>
            setSelected((old) =>
              e.target.checked ? [...old, part] : old.filter((p) => p !== part),
            )
          }
        />
        <span>{t(`feedback.parts.${part}`)}</span>
      </label>
    );
  }

  function shotBlock() {
    if (capturing === 'loading')
      return (
        <div className="feedback-shot feedback-shot--loading" role="status">
          {t('feedback.capturing')}
        </div>
      );
    if (shot && shotIncluded)
      return (
        <div className="feedback-shot">
          <img src={shot.url} alt={t('feedback.screenshot')} />
          <div className="feedback-shot__tools">
            <Button icon="pen" onClick={() => setEditing('draw')}>
              {t('feedback.draw')}
            </Button>
            <Button icon="eyeOff" onClick={() => setEditing('redact')}>
              {t('feedback.blur')}
            </Button>
            {!guest && (
              <Button
                icon="image"
                className="feedback-shot__again"
                aria-label={t('feedback.recaptureLabel')}
                onClick={() => {
                  setCapturePill(true);
                  minimize();
                }}
              >
                <span>{t('feedback.recapture')}</span>
              </Button>
            )}
          </div>
          {redactedAreas > 0 && (
            <span className="feedback-shot__note">
              {t('feedback.redactedAreas', { count: redactedAreas })}
            </span>
          )}
        </div>
      );
    return (
      <div className="feedback-shot feedback-shot--empty">
        <span>{t(capturing === 'error' ? 'feedback.captureFailed' : 'feedback.noScreenshot')}</span>
        <span className="feedback-row">
          <Button
            icon={capturing === 'error' ? undefined : 'image'}
            onClick={() => {
              if (shot) setShotIncluded(true);
              else if (guest || capturing === 'error') void capture();
              else {
                setCapturePill(true);
                minimize();
              }
            }}
          >
            {t(capturing === 'error' ? 'feedback.retry' : 'feedback.capture')}
          </Button>
          <Button icon="upload" onClick={() => imageInput.current?.click()}>
            {t('feedback.chooseImage')}
          </Button>
        </span>
      </div>
    );
  }

  function composeBody() {
    return (
      <>
        {prefill?.errorId && (
          <Banner tone="info" icon="warning" role="note">
            {t('feedback.attachingError')} ·{' '}
            <code>{t('feedback.errorId', { id: prefill.errorId })}</code>
          </Banner>
        )}
        <Segmented
          label={t('feedback.type')}
          value={type}
          onChange={changeType}
          options={(['bug', 'idea', 'question'] as const).map((value) => ({
            value,
            label: t(`feedback.types.${value}`),
          }))}
        />
        <div ref={titleBox}>
          <TextField
            label={t('feedback.titleLabel')}
            value={title}
            maxLength={160}
            placeholder={t('feedback.titlePlaceholder')}
            error={attempted && !title.trim() ? t('feedback.titleRequired') : null}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <label className="ink-field">
          <span className="ink-field__label">{t('feedback.description')}</span>
          <textarea
            className="ink-input"
            value={description}
            maxLength={guest ? 4000 : 12000}
            placeholder={t(
              prefill?.errorId
                ? 'feedback.errorPlaceholder'
                : type === 'bug'
                  ? 'feedback.descriptionPlaceholder'
                  : 'feedback.ideaPlaceholder',
            )}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {guest && (
          <TextField
            label={t('feedback.guestName')}
            value={guestName}
            maxLength={80}
            onChange={(e) => setGuestName(e.target.value)}
          />
        )}
        {shotBlock()}
        {relay && !guest && (
          <p className="feedback-text" role={relayOver ? 'alert' : undefined}>
            {t(relayOver ? 'feedback.relayTotalTooBig' : 'feedback.relayLimits')}
          </p>
        )}
        {!guest && (
          <div className="feedback-row feedback-att">
            <Button
              icon={shot && shotIncluded ? 'check' : 'image'}
              aria-pressed={!!shot && shotIncluded}
              onClick={() => {
                if (shot) setShotIncluded(!shotIncluded);
                else void capture();
              }}
            >
              {t('feedback.screenshot')}
            </Button>
            {video ? (
              <Button
                icon="check"
                aria-pressed
                onClick={() => {
                  setCandidate(video);
                  setPhase('videoReview');
                }}
              >
                {video.seconds === undefined
                  ? t('feedback.videoAttached')
                  : t('feedback.videoLength', { length: clock(video.seconds) })}
              </Button>
            ) : (
              <Button
                icon={canRecord ? 'film' : 'upload'}
                onClick={() => {
                  if (canRecord) setPhase('recordIntro');
                  else {
                    setRecordHint(true);
                    fileInput.current?.click();
                  }
                }}
              >
                {t(canRecord ? 'feedback.record' : 'feedback.attachVideo')}
              </Button>
            )}
            <Button icon="file" onClick={() => fileInput.current?.click()}>
              {files.length ? t('feedback.filesCount', { n: files.length }) : t('feedback.files')}
            </Button>
          </div>
        )}
        {recordHint && !canRecord && (
          <Banner tone="info" icon="film" role="note">
            {t('feedback.recordUnavailable')}
          </Banner>
        )}
        {dragging && !guest ? (
          <div className="feedback-drop">
            <Icon name="upload" size={20} />
            {t('feedback.dropHere')}
            <span>{t(relay ? 'feedback.relayLimits' : 'feedback.dropLimits')}</span>
          </div>
        ) : (
          files.length > 0 && (
            <ul className="feedback-files" aria-label={t('feedback.attachedFiles')}>
              {files.map((file) => (
                <li key={file.key} className={file.error ? 'feedback-file--bad' : undefined}>
                  <Icon
                    name={
                      file.error
                        ? 'warning'
                        : file.blob.type.startsWith('image/')
                          ? 'image'
                          : 'file'
                    }
                  />
                  <span className="feedback-files__name">
                    <b title={file.name}>{file.name}</b>
                    <small role={file.error ? 'alert' : undefined}>
                      {file.error ?? size(file.blob.size)}
                    </small>
                  </span>
                  <IconButton
                    icon="close"
                    label={t('feedback.removeFile', { name: file.name })}
                    onClick={() => {
                      drop(file);
                      setFiles(files.filter((f) => f !== file));
                    }}
                  />
                </li>
              ))}
            </ul>
          )
        )}
        <fieldset className="feedback-send">
          <legend>{t('feedback.whatSends')}</legend>
          {parts.map((part) => (
            <div key={part}>{partChoice(part)}</div>
          ))}
        </fieldset>
        {relay ? (
          <p className="feedback-privacy">
            <Icon name="lock" size={14} />
            <span>{t('feedback.relayNote')}</span>
          </p>
        ) : (
          guest && privacy
        )}
      </>
    );
  }

  function previewBody() {
    if (busy)
      return (
        <>
          {typeTag}
          <div className="feedback-sending" role="status" aria-live="polite">
            <div
              className="feedback-progress"
              role="progressbar"
              aria-label={t('feedback.sending')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                progress ? Math.round((progress.loaded / Math.max(1, progress.total)) * 100) : 100
              }
            >
              <i
                style={{
                  width: `${progress ? (progress.loaded / Math.max(1, progress.total)) * 100 : 100}%`,
                }}
              />
            </div>
            <p>
              {progress
                ? t(`feedback.uploading.${progress.kind}`, {
                    name: progress.name,
                    loaded: size(progress.loaded),
                    total: size(progress.total),
                  })
                : t('feedback.sending')}
            </p>
          </div>
        </>
      );
    const list = sent();
    return (
      <>
        {failure?.kind === 'failed' && (
          <Banner tone="danger" icon="warning" role="alert">
            <p>
              <b>{t('feedback.sendFailed')}</b> {t('feedback.sendFailedKeep')}
            </p>
            <p>
              {failure.detail ? `${t('feedback.errorCode', { code: failure.detail })} · ` : ''}
              {t('feedback.errorId', {
                id: `${requestId.current.slice(0, 4)}-${requestId.current.slice(4, 8)}`,
              })}
            </p>
          </Banner>
        )}
        {failure?.kind === 'interrupted' && (
          <Banner tone="warn" icon="warning" role="alert">
            {t('feedback.interrupted')}
          </Banner>
        )}
        {failure?.kind === 'refused' && (
          <Banner tone="warn" icon="warning" role="alert">
            {t('feedback.refused', { name: failure.detail })}
          </Banner>
        )}
        {failure?.kind === 'destination' && (
          <Banner tone="warn" icon="warning" role="alert">
            {t('feedback.destinationChanged')}
          </Banner>
        )}
        {failure?.kind === 'limited' && (
          <Banner tone="warn" icon="clock" role="alert">
            {t('feedback.rateLimited', { count: Number(failure.detail) })}
          </Banner>
        )}
        {!online && (
          <Banner tone="warn" icon="warning">
            <b>{t('feedback.offline')}</b> {t('feedback.offlineHint')}
          </Banner>
        )}
        {online && backOnline && (
          <Banner tone="ok" icon="check">
            {t('feedback.backOnline')}
          </Banner>
        )}
        {typeTag}
        {description && <p className="feedback-text">{description}</p>}
        {list.length > 0 && (
          <div className="feedback-section">
            <h4>{t('feedback.attachments')}</h4>
            {shot && shotIncluded && shotAutomatic && (
              <p className="feedback-text feedback-hint">{t('feedback.shotPrivacy')}</p>
            )}
            <div className="feedback-thumbs">
              {list.map((item) => (
                <div className="feedback-thumb" key={item.key}>
                  <div>
                    {item.kind === 'screenshot' ? (
                      <img src={item.url} alt={t('feedback.screenshot')} />
                    ) : (
                      <Icon name={item.kind === 'video' ? 'film' : 'file'} size={22} />
                    )}
                  </div>
                  <small title={item.name}>
                    {item.kind === 'screenshot'
                      ? redactedAreas
                        ? `${t('feedback.screenshot')} · ${t('feedback.redactedAreas', { count: redactedAreas })}`
                        : t('feedback.screenshot')
                      : item.kind === 'video'
                        ? `${t('feedback.video')} · ${item.seconds === undefined ? '' : `${clock(item.seconds)} · `}${size(item.blob.size)}`
                        : `${item.name} · ${size(item.blob.size)}`}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="feedback-section">
          <h4>{t('feedback.exactData')}</h4>
          <p className="feedback-text feedback-hint">
            <mark>{t('feedback.highlighted')}</mark> {t('feedback.redactionHint')}
          </p>
          {parts.map((part) => (
            <details
              key={part}
              className="feedback-part"
              open={part === 'environment' || part === 'page' || part === 'console'}
              data-off={selected.includes(part) ? undefined : true}
            >
              <summary>
                <Icon name="chevronRight" size={14} />
                {partChoice(part)}
              </summary>
              <pre>
                <RedactedText text={data?.[part] || t('feedback.noData')} />
              </pre>
            </details>
          ))}
        </div>
        {privacy}
      </>
    );
  }

  function doneBody() {
    const reference = receipt?.reference ?? '';
    const repository = receipt?.issueUrl?.match(/github\.com\/[^/]+\/([^/]+)\//)?.[1];
    const message =
      relay && receipt?.delivery === 'pending' ? (
        t('feedback.relayPending')
      ) : relay && receipt?.delivery === 'refused' ? (
        t('feedback.relayRefused')
      ) : relay && receipt?.delivery === 'uncertain' ? (
        t('feedback.relayUnavailable')
      ) : receipt?.duplicate ? (
        <>
          {t('feedback.knownError')} <code>{reference}</code>.
        </>
      ) : receipt?.delivery === 'inbox' ? (
        t('feedback.sentInbox')
      ) : receipt?.issueUrl ? (
        <>
          {t('feedback.openedAs')} <code>{`${repository}${reference}`}</code>.
        </>
      ) : (
        <>
          {t('feedback.referenceIs')} <code>{reference}</code>
          {t('feedback.referenceHint')}
        </>
      );
    return (
      <div className="feedback-done">
        <span className="feedback-done__icon">
          <Icon name="check" size={20} />
        </span>
        <b role="status">
          {t(relay && receipt?.delivery !== 'delivered' ? 'feedback.relaySaved' : 'feedback.sent')}
        </b>
        <p>{message}</p>
      </div>
    );
  }

  function finishRecord(discard: boolean) {
    discardRecording.current = discard;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  const titles: Record<Phase, string> = {
    compose: t('feedback.title'),
    off: t('feedback.title'),
    done: t('feedback.title'),
    preview: t('feedback.previewTitle'),
    recordIntro: t('feedback.recordTitle'),
    videoReview: t('feedback.reviewVideo'),
  };
  const acceptVideo = () => {
    if (candidate !== video) drop(video);
    if (candidate) setVideo(candidate);
    setCandidate(null);
    setPhase('compose');
  };
  /** Out of the review; a video attached earlier stays attached unless it is removed. */
  const leaveReview = (remove: boolean, next: Phase = 'compose') => {
    if (remove || candidate !== video) drop(candidate);
    if (remove && candidate === video) setVideo(null);
    setCandidate(null);
    setPhase(next);
  };

  if (!open && !recording && !capturePill) return null;
  return (
    // Never part of the screenshot: the form, the pill and the editor are not the problem.
    <div data-feedback-exclude>
      {recording && (
        <section
          className={`feedback-pill${remaining <= 10 ? ' feedback-pill--warn' : ''}`}
          aria-label={t('feedback.recordingLabel')}
        >
          <span className="feedback-pill__dot" aria-hidden="true" />
          <span>{t('feedback.recording')}</span>
          <b>{t('feedback.remaining', { time: clock(remaining) })}</b>
          <span className="feedback-progress" aria-hidden="true">
            <i style={{ width: `${((RECORD_SECONDS - remaining) / RECORD_SECONDS) * 100}%` }} />
          </span>
          {/* Announced at 30 and at 10 seconds, not at every second. */}
          <span className="ink-sr-only" aria-live="polite">
            {remaining === 30 || remaining === 10
              ? t('feedback.remaining', { time: clock(remaining) })
              : ''}
          </span>
          <Button variant="primary" onClick={() => finishRecord(false)}>
            {t('feedback.stop')}
          </Button>
          <Button variant="ghost" onClick={() => finishRecord(true)}>
            {t('feedback.cancel')}
          </Button>
        </section>
      )}
      {capturePill && (
        <div className="feedback-pill" role="status">
          <Icon name="image" />
          <span>{t('feedback.navigateCapture')}</span>
          <Button
            variant="primary"
            onClick={() => {
              setCapturePill(false);
              setOpen(true);
              void capture();
            }}
          >
            {t('feedback.captureNow')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCapturePill(false);
              setOpen(true);
            }}
          >
            {t('feedback.cancel')}
          </Button>
        </div>
      )}
      {editing && shot && (
        <ScreenshotEditor
          source={shot.blob}
          initialTool={editing}
          onClose={() => setEditing(null)}
          onSave={(blob, areas) => {
            const item = local(blob, 'screenshot', 'screenshot.png');
            item.redactedAreas = redactedAreas + areas;
            drop(shot);
            setShot(item);
            setEditing(null);
          }}
        />
      )}
      {open && (
        <Dialog
          ref={dialog}
          open
          title={titles[phase]}
          dirty={dirty}
          onCancel={(event) => {
            // Inside a step, Escape goes back to the form.
            if (phase === 'recordIntro' || phase === 'videoReview') {
              event.preventDefault();
              if (phase === 'videoReview') leaveReview(false);
              else setPhase('compose');
            }
            if (busy) abort.current?.abort();
          }}
          onClose={() => {
            setOpen(false);
            if (phase !== 'off') reset();
          }}
        >
          {phase === 'compose' && <FeedbackKeys />}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the File button does this by keyboard */}
          <div
            ref={content}
            className={`feedback-content feedback-content--${phase}`}
            onDragEnter={(e) => {
              if (guest || !e.dataTransfer.types.includes('Files')) return;
              dragDepth.current++;
              setDragging(true);
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDragOver={(e) => {
              if (!guest) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (!guest) addFiles(e.dataTransfer.files);
            }}
          >
            <input
              hidden
              ref={fileInput}
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              hidden
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files, true);
                e.target.value = '';
              }}
            />
            {phase === 'off' && (
              <div className="feedback-done">
                <span className="feedback-done__icon feedback-done__icon--off">
                  <Icon name="report" size={20} />
                </span>
                <b>{t('feedback.offTitle')}</b>
                <p>{t(user?.role === 'admin' ? 'feedback.offAdmin' : 'feedback.offMember')}</p>
              </div>
            )}
            {phase === 'compose' && composeBody()}
            {phase === 'preview' && previewBody()}
            {phase === 'done' && doneBody()}
            {phase === 'recordIntro' &&
              (permission ? (
                <Banner tone="warn" icon="warning" role="alert">
                  {t('feedback.permissionDenied')}
                </Banner>
              ) : (
                <>
                  <p className="feedback-text">{t('feedback.recordIntro')}</p>
                  <div className="feedback-send feedback-send--notes">
                    <p>
                      <Icon name="clock" size={14} />
                      {t(relay ? 'feedback.relayRecordLimit' : 'feedback.recordLimit')}
                    </p>
                    <p>
                      <Icon name="eyeOff" size={14} />
                      {t('feedback.recordPrivacy')}
                    </p>
                    <p>
                      <Icon name="board" size={14} />
                      {t('feedback.recordChooseTab')}
                    </p>
                  </div>
                </>
              ))}
            {phase === 'videoReview' && candidate && (
              <>
                {wholeScreen && (
                  <Banner tone="danger" icon="warning" role="alert">
                    <b>{t('feedback.wholeScreenTitle')}</b> {t('feedback.wholeScreen')}
                  </Banner>
                )}
                {/* biome-ignore lint/a11y/useMediaCaption: a silent screen recording has no speech */}
                <video
                  className="feedback-player"
                  muted
                  src={candidate.url}
                  controls
                  playsInline
                  aria-label={t('feedback.reviewVideo')}
                />
                <p className="feedback-meta">
                  {candidate.seconds === undefined ? '' : `${clock(candidate.seconds)} · `}
                  {size(candidate.blob.size)}
                  {candidate.seconds === undefined ? '' : ` · ${t('feedback.noAudio')}`}
                </p>
                {!wholeScreen && (
                  <Banner tone="warn" icon="warning" role="note">
                    {t('feedback.videoWarning')}
                  </Banner>
                )}
              </>
            )}
          </div>
          <DialogActions>
            {phase === 'off' &&
              (user?.role === 'admin' ? (
                <>
                  <Button variant="ghost" onClick={() => dialog.current?.requestClose()}>
                    {t('feedback.close')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      navigate('/settings?section=instance');
                      dialog.current?.requestClose();
                    }}
                  >
                    {t('feedback.configure')}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => dialog.current?.requestClose()}>
                  {t('feedback.close')}
                </Button>
              ))}
            {phase === 'done' && (
              <>
                {receipt?.issueUrl ? (
                  <a
                    className="ink-btn ink-btn--secondary"
                    href={receipt.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="link" size={14} />
                    {t('feedback.openIssue')}
                  </a>
                ) : (
                  receipt?.delivery !== 'inbox' &&
                  !receipt?.duplicate && (
                    <Button
                      onClick={() =>
                        void navigator.clipboard.writeText(receipt?.reference ?? '').catch(() => {})
                      }
                    >
                      {t('feedback.copyReference')}
                    </Button>
                  )
                )}
                <Button variant="primary" onClick={() => dialog.current?.requestClose()}>
                  {t('feedback.close')}
                </Button>
              </>
            )}
            {phase === 'compose' && (
              <>
                <Button variant="ghost" onClick={() => dialog.current?.requestClose()}>
                  {t('feedback.cancel')}
                </Button>
                <Button variant="primary" disabled={capturing === 'loading'} onClick={toPreview}>
                  {t('feedback.preview')}
                </Button>
              </>
            )}
            {phase === 'preview' &&
              (busy ? (
                <>
                  <Button variant="ghost" onClick={() => abort.current?.abort()}>
                    {t('feedback.interrupt')}
                  </Button>
                  <Button variant="primary" disabled>
                    {t('feedback.sending')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setPhase('compose')}>
                    {t('feedback.back')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!online || retryAt > Date.now()}
                    onClick={() => void send()}
                  >
                    {t(failure ? 'feedback.retry' : 'feedback.send')}
                  </Button>
                </>
              ))}
            {phase === 'recordIntro' && (
              <>
                <Button variant="ghost" onClick={() => setPhase('compose')}>
                  {t('feedback.back')}
                </Button>
                {permission && (
                  <Button icon="upload" onClick={() => fileInput.current?.click()}>
                    {t('feedback.attachVideo')}
                  </Button>
                )}
                <Button variant="primary" onClick={() => void record()}>
                  {t(permission ? 'feedback.retry' : 'feedback.startRecord')}
                </Button>
              </>
            )}
            {phase === 'videoReview' && (
              <>
                <span className="feedback-spacer">
                  <Button icon="trash" variant="ghost" onClick={() => leaveReview(true)}>
                    {t('feedback.removeVideo')}
                  </Button>
                </span>
                {canRecord && (
                  <Button onClick={() => leaveReview(true, 'recordIntro')}>
                    {t('feedback.rerecord')}
                  </Button>
                )}
                <Button variant="primary" disabled={!candidate} onClick={acceptVideo}>
                  {t('feedback.useVideo')}
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
