import { describe, expect, it } from 'vitest';
import { recorderType, voiceNoteFile } from './VoiceNote.tsx';

describe('voice notes (#327)', () => {
  it('records Opus where the browser can, AAC on Safari, else what it picks', () => {
    expect(recorderType(() => true)).toBe('audio/webm;codecs=opus');
    expect(recorderType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(recorderType(() => false)).toBe('');
  });

  it('names the file by the time, with the extension of what was recorded', () => {
    const at = new Date(2026, 10, 1, 9, 5);
    const webm = voiceNoteFile([new Blob(['x'])], 'audio/webm;codecs=opus', 'nota-vocale', at);
    expect(webm.name).toBe('nota-vocale-2026-11-01-0905.webm');
    expect(webm.type).toBe('audio/webm');
    expect(voiceNoteFile([], 'audio/mp4', 'voice-note', at).name).toBe(
      'voice-note-2026-11-01-0905.m4a',
    );
    expect(voiceNoteFile([], '', 'n', at).type).toBe('audio/webm');
  });
});
