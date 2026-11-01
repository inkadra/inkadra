// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Asset,
  DEFAULT_EXPORT_PREFERENCES,
  EXPORT_LOGO_MAX_BYTES,
  EXPORT_LOGO_TYPES,
  type ExportPreferences,
  type ExportPreset,
  type ExportSettings,
  type UpdateExportSettings,
} from '@inkadra/shared';
import { api } from '../../lib/api.ts';
import { resolveTheme } from '../theme.ts';
import { startUpload } from '../uploads.ts';
import type { ExportRequest, ExportWhat } from './engine.ts';
import type { PaperSize } from './layout.ts';

/** Where the dialog was opened from: the canvas offers board scopes, film views their own. */
export type ExportSource = 'canvas' | 'storyboard' | 'shotlist' | 'schedule';

export const PRESET_ORDER: readonly ExportPreset[] = [
  'client-pitch',
  'production-book',
  'internal-kickoff',
];

/** 1-based number shown on the preset badge and in the "editing preset N" summary. */
export function presetNumber(preset: ExportPreset): 1 | 2 | 3 {
  return (PRESET_ORDER.indexOf(preset) + 1) as 1 | 2 | 3;
}

/**
 * The preset marked "Recommended" for the open view: Storyboard → Client pitch, Shot list →
 * Production book, Schedule → Internal kickoff.
 */
export function recommendedPreset(source: ExportSource): ExportPreset {
  if (source === 'shotlist') return 'production-book';
  if (source === 'schedule') return 'internal-kickoff';
  return 'client-pitch';
}

export type PresetChoices = Omit<ExportRequest, 'logo' | 'theme'>;

/**
 * The existing export options (decision 0038/0039) a preset fills in. On an ordinary canvas
 * board `what` stays on the current board scope (`currentWhat` or `'board'`), because storyboard
 * and shot list scopes exist only on film boards.
 */
export function presetChoices(
  preset: ExportPreset,
  source: ExportSource,
  currentWhat: ExportWhat = 'board',
  language?: string,
): PresetChoices {
  const film = source !== 'canvas';
  switch (preset) {
    case 'client-pitch':
      return {
        format: 'pdf',
        what: film ? 'storyboard' : currentWhat,
        framesPerPage: 1,
        paper: localePaper(language),
        orientation: 'landscape',
        audience: 'client',
        titlePage: true,
        comments: false,
        hideGuestHidden: true,
      };
    case 'production-book':
      return {
        format: 'pdf',
        what: film ? 'shotlist' : currentWhat,
        framesPerPage: 4,
        paper: 'a4',
        orientation: 'portrait',
        audience: 'team',
        titlePage: true,
        comments: false,
        hideGuestHidden: false,
      };
    case 'internal-kickoff':
      return {
        format: 'pdf',
        what: film ? 'storyboard' : currentWhat,
        framesPerPage: 4,
        paper: localePaper(language),
        orientation: 'landscape',
        audience: 'team',
        titlePage: true,
        comments: true,
        hideGuestHidden: false,
      };
  }
}

/**
 * Whether the current options still match `preset`, or have been edited by hand. Canvas boards
 * ignore `what` so changing the board scope (whole board / selection / visible) does not deselect
 * the preset; paper matches either the preset's locale default or the stored paper size.
 */
export function matchesPreset(
  req: PresetChoices,
  preset: ExportPreset,
  source: ExportSource,
  language?: string,
  storedPaper?: PaperSize | null,
): boolean {
  const expected = presetChoices(preset, source, req.what, language);
  const paperMatches =
    req.paper === expected.paper || (storedPaper != null && req.paper === storedPaper);
  return (
    req.format === expected.format &&
    (source === 'canvas' || req.what === expected.what) &&
    (req.what !== 'storyboard' || req.framesPerPage === expected.framesPerPage) &&
    paperMatches &&
    req.orientation === expected.orientation &&
    req.audience === expected.audience &&
    (req.format !== 'pdf' || req.titlePage === expected.titlePage) &&
    (req.format !== 'pdf' || req.comments === expected.comments) &&
    (req.audience === 'client' || req.hideGuestHidden === expected.hideGuestHidden)
  );
}

/** Whether `preset` exports the content kind of the view the dialog was opened from. */
export function presetMatchesView(
  preset: ExportPreset,
  source: ExportSource,
  initialWhat?: ExportWhat,
): boolean {
  if (source === 'canvas') return true;
  const viewWhat: ExportWhat = initialWhat ?? (source === 'shotlist' ? 'shotlist' : 'storyboard');
  return presetChoices(preset, source).what === viewWhat;
}

function isDefaultPreferences(prefs: ExportPreferences): boolean {
  return (
    prefs.preset === DEFAULT_EXPORT_PREFERENCES.preset &&
    prefs.format === DEFAULT_EXPORT_PREFERENCES.format &&
    prefs.framesPerPage === DEFAULT_EXPORT_PREFERENCES.framesPerPage &&
    prefs.paper === DEFAULT_EXPORT_PREFERENCES.paper &&
    prefs.orientation === DEFAULT_EXPORT_PREFERENCES.orientation &&
    prefs.audience === DEFAULT_EXPORT_PREFERENCES.audience &&
    prefs.titlePage === DEFAULT_EXPORT_PREFERENCES.titlePage &&
    prefs.comments === DEFAULT_EXPORT_PREFERENCES.comments &&
    prefs.hideGuestHidden === DEFAULT_EXPORT_PREFERENCES.hideGuestHidden
  );
}

/**
 * Starting state of the dialog once the project's export settings load:
 * - A project that never saved preferences (or only uploaded a logo or theme) starts on the
 *   view's recommended preset with Personalizza closed.
 * - A remembered preset is used only if its content matches the open view; otherwise the view's
 *   recommended preset is selected so opening from Shot list never silently exports the storyboard.
 * - Personalizza opens automatically only when stored preferences do not match any preset.
 */
export function initialExportState(
  loaded: ExportSettings,
  source: ExportSource,
  initialWhat?: ExportWhat,
  language?: string,
): {
  basePreset: ExportPreset;
  customOpen: boolean;
  req: ExportRequest;
} {
  const recommended = recommendedPreset(source);
  const {
    logo,
    logoAssetId: _id,
    canEdit: _edit,
    updatedAt,
    preset: savedPreset,
    theme: _theme,
    projectColor: _color,
    ...prefs
  } = loaded;
  const theme = resolveTheme(loaded);
  if (!updatedAt || (savedPreset === null && isDefaultPreferences(loaded))) {
    return {
      basePreset: recommended,
      customOpen: false,
      req: {
        ...presetChoices(recommended, source, initialWhat, language),
        logo,
        theme,
      },
    };
  }
  if (savedPreset !== null) {
    if (!presetMatchesView(savedPreset, source, initialWhat)) {
      return {
        basePreset: recommended,
        customOpen: false,
        req: {
          ...presetChoices(recommended, source, initialWhat, language),
          logo,
          theme,
        },
      };
    }
    const what: ExportWhat =
      source === 'canvas' ? (initialWhat ?? 'board') : presetChoices(savedPreset, source).what;
    const req: ExportRequest = {
      ...prefs,
      what,
      paper: prefs.paper ?? localePaper(language),
      logo,
      theme,
    };
    const matches = matchesPreset(req, savedPreset, source, language, prefs.paper);
    return {
      basePreset: savedPreset,
      customOpen: !matches,
      req,
    };
  }
  const what: ExportWhat =
    initialWhat ??
    (source === 'canvas' ? 'board' : source === 'shotlist' ? 'shotlist' : 'storyboard');
  const req: ExportRequest = {
    ...prefs,
    what,
    paper: prefs.paper ?? localePaper(language),
    logo,
    theme,
  };
  const matched =
    [recommended, ...PRESET_ORDER].find(
      (p) =>
        presetMatchesView(p, source, initialWhat) &&
        matchesPreset(req, p, source, language, prefs.paper),
    ) ?? null;
  if (matched) {
    return {
      basePreset: matched,
      customOpen: false,
      req,
    };
  }
  return {
    basePreset: recommended,
    customOpen: true,
    req,
  };
}

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
    'preset',
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
