// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Types MediaRecorder is asked for, best first: Opus in WebM or Ogg, AAC on Safari. */
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

/** shortcut: a voice note stops at 15 minutes; longer takes are uploaded as files. */
export const VOICE_NOTE_MAX_MS = 15 * 60_000;

/** The first type this browser records, or '' to let it choose. */
export function recorderType(supported: (type: string) => boolean): string {
  return TYPES.find(supported) ?? '';
}

/** `nota-vocale-2026-11-01-1432.webm`: the recording as a file to upload, named by its time. */
export function voiceNoteFile(chunks: Blob[], type: string, prefix: string, now: Date): File {
  const mime = type.split(';')[0] || 'audio/webm';
  const ext = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return new File(chunks, `${prefix}-${stamp}.${ext}`, { type: mime });
}

/** Whether this browser can record at all (a secure page with a microphone API). */
export const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Records a voice note from the microphone (#327) while it is open: a pill above the tool bar
 * with the time, Save and Cancel. Save hands the recording to `onSave` as a file, which the
 * board uploads as an audio card; Cancel and Escape throw it away.
 */
export function VoiceNoteRecorder({
  onSave,
  onClose,
}: {
  onSave: (file: File) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const [denied, setDenied] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  const done = useRef({ onSave, onClose });
  done.current = { onSave, onClose };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    const chunks: Blob[] = [];
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        if (cancelled) return stopTracks(s);
        const type = recorderType((ty) => MediaRecorder.isTypeSupported(ty));
        const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
        recorder.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => {
          window.clearInterval(timer);
          stopTracks(s);
          try {
            if (keep.current && chunks.length > 0)
              done.current.onSave(
                voiceNoteFile(chunks, rec.mimeType || type, t('board.voiceNote.file'), new Date()),
              );
          } finally {
            done.current.onClose();
          }
        };
        const started = Date.now();
        rec.start(1000);
        timer = window.setInterval(() => {
          const ms = Date.now() - started;
          setElapsed(ms);
          if (ms >= VOICE_NOTE_MAX_MS && rec.state === 'recording') {
            keep.current = true;
            rec.stop();
          }
        }, 250);
      })
      .catch(() => setDenied(true));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (recorder.current?.state === 'recording') {
        keep.current = false;
        recorder.current.stop();
      }
      if (stream) stopTracks(stream);
    };
  }, [t]);

  function stop(save: boolean) {
    keep.current = save;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else done.current.onClose();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape for the whole pill
    <div
      className="voicenote"
      data-chrome
      role="status"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        stop(false);
      }}
    >
      {denied ? (
        <span className="voicenote__msg">{t('board.voiceNote.denied')}</span>
      ) : (
        <>
          <span className="voicenote__dot" aria-hidden="true" />
          <span className="voicenote__msg">{t('board.voiceNote.recording')}</span>
          <span className="voicenote__time">{clock(elapsed)}</span>
        </>
      )}
      <Button variant="ghost" onClick={() => stop(false)}>
        {t(denied ? 'board.voiceNote.close' : 'board.voiceNote.cancel')}
      </Button>
      {!denied && (
        <Button
          variant="primary"
          // biome-ignore lint/a11y/noAutofocus: the pill takes the keyboard while it records
          autoFocus
          onClick={() => stop(true)}
        >
          {t('board.voiceNote.save')}
        </Button>
      )}
    </div>
  );
}
