import { DEFAULT_EXPORT_PREFERENCES } from '@inkadra/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  LogoTimeoutError,
  localePaper,
  logoProblem,
  preferencesPatch,
  uploadLogo,
} from './settings.ts';

// The upload panel already holds this file: it resumes that upload and never calls onAsset.
vi.mock('../uploads.ts', () => ({ startUpload: vi.fn(() => 'u1') }));

describe('export settings on the client', () => {
  it('reads a null paper as the reader’s own default', () => {
    expect(localePaper('en-US')).toBe('letter');
    expect(localePaper('fr-CA')).toBe('letter');
    expect(localePaper('it-IT')).toBe('a4');
    expect(localePaper('en-GB')).toBe('a4');
  });

  it('sends only what changed, and keeps a null paper when the default was kept', () => {
    const chosen = { ...DEFAULT_EXPORT_PREFERENCES, paper: 'a4' as const };
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'it-IT')).toEqual({});
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'en-US')).toEqual({ paper: 'a4' });
    expect(
      preferencesPatch(
        DEFAULT_EXPORT_PREFERENCES,
        { ...chosen, framesPerPage: 6, audience: 'team' },
        'it-IT',
      ),
    ).toEqual({ framesPerPage: 6, audience: 'team' });
  });

  it('accepts small PNG and JPEG logos only', () => {
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/jpeg', size: 512 * 1024 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 1000 })).toBe('type');
    expect(logoProblem({ type: 'image/webp', size: 1000 })).toBe('type');
    expect(logoProblem({ type: 'image/png', size: 512 * 1024 + 1 })).toBe('size');
  });
});

describe('uploadLogo', () => {
  it('gives up with a timeout instead of waiting for ever', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
      type: 'image/png',
    });
    await expect(uploadLogo(file, 'p1', 'b1', 20)).rejects.toBeInstanceOf(LogoTimeoutError);
  });
});
