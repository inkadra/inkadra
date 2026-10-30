// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Asset,
  EXPORT_LOGO_MAX_BYTES,
  EXPORT_LOGO_TYPES,
  type ExportPreferences,
  type ExportSettings,
  type UpdateExportSettings,
} from '@inkadra/shared';
import { api } from '../../lib/api.ts';
import { startUpload } from '../uploads.ts';
import type { PaperSize } from './layout.ts';

/**
 * The project's shared export settings (decision 0039): the dialog starts from them, editors
 * save their last choices back, and the logo is an asset of the project.
 */
export function fetchExportSettings(projectId: string): Promise<ExportSettings> {
  return api.get<ExportSettings>(`/projects/${projectId}/export-settings`);
}

export function saveExportSettings(
  projectId: string,
  patch: UpdateExportSettings,
): Promise<ExportSettings> {
  return api.patch<ExportSettings>(`/projects/${projectId}/export-settings`, patch);
}

/** Letter in the United States and Canada, A4 everywhere else: what a null paper means. */
export function localePaper(language = navigator.language): PaperSize {
  return /-(US|CA)$/i.test(language) ? 'letter' : 'a4';
}

/**
 * The preferences that differ from the stored ones. A paper equal to the reader's own default
 * stays null when it was null, so people in different countries keep their own default.
 */
export function preferencesPatch(
  stored: ExportPreferences,
  chosen: Omit<ExportPreferences, 'paper'> & { paper: PaperSize },
  language?: string,
): Partial<ExportPreferences> {
  const out: Partial<ExportPreferences> = {};
  const keys = [
    'format',
    'framesPerPage',
    'orientation',
    'audience',
    'titlePage',
    'comments',
    'hideGuestHidden',
  ] as const;
  for (const key of keys) {
    if (stored[key] !== chosen[key]) (out as Record<string, unknown>)[key] = chosen[key];
  }
  const storedPaper = stored.paper ?? localePaper(language);
  if (chosen.paper !== storedPaper) out.paper = chosen.paper;
  return out;
}

/** Why a file cannot be the logo, or null when it can. */
export function logoProblem(file: Pick<File, 'type' | 'size'>): 'type' | 'size' | null {
  if (!(EXPORT_LOGO_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > EXPORT_LOGO_MAX_BYTES) return 'size';
  return null;
}

/** Where to draw the logo from: its largest thumbnail, or the original when it has none. */
export function logoUrl(asset: Asset): string {
  return asset.variants.at(-1)?.url ?? asset.url;
}

export class LogoTimeoutError extends Error {}

/**
 * Uploads a logo into the project like any file and resolves with its asset id once the worker
 * has made it ready (the server refuses a logo that is not). The file gets a fresh
 * `lastModified`, so the upload panel never merges it with the same file added before, which
 * would never call `onAsset`; and the whole wait is bounded.
 */
export function uploadLogo(
  file: File,
  projectId: string,
  boardId: string,
  timeoutMs = 120_000,
): Promise<string> {
  const unique = new File([file], file.name, { type: file.type, lastModified: Date.now() });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new LogoTimeoutError())), timeoutMs);
    startUpload({
      file: unique,
      projectId,
      boardId,
      onAsset: (id) => {
        void waitReady(id, () => settled).then(
          (ok) => finish(() => resolve(ok)),
          (err: unknown) => finish(() => reject(err)),
        );
      },
      onFailed: () => finish(() => reject(new Error('Logo upload failed'))),
    });
  });
}

async function waitReady(id: string, stop: () => boolean): Promise<string> {
  while (!stop()) {
    const asset = await api.get<Asset>(`/assets/${id}`).catch(() => null);
    if (asset?.status === 'failed') throw new Error('Logo processing failed');
    if (asset?.status === 'ready') return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  return id;
}
