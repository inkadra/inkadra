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

/**
 * Uploads a logo into the project like any file and resolves with its asset id once the bytes
 * have arrived (the server refuses a logo whose upload is not finished).
 */
export function uploadLogo(file: File, projectId: string, boardId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let assetId: string | null = null;
    startUpload({
      file,
      projectId,
      boardId,
      onAsset: (id) => {
        assetId = id;
        void waitUploaded(id).then(resolve, reject);
      },
      onFailed: () => reject(new Error(`Logo upload failed${assetId ? ` (${assetId})` : ''}`)),
    });
  });
}

async function waitUploaded(id: string, timeoutMs = 60_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const asset = await api.get<Asset>(`/assets/${id}`).catch(() => null);
    if (asset?.status === 'failed') throw new Error('Logo processing failed');
    if (asset && asset.status !== 'pending') return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Logo upload timed out');
}
