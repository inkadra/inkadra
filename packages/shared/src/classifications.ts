// SPDX-License-Identifier: MPL-2.0
import { SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES } from '@inkadra/doc-schema';
import { z } from './common.ts';

export const ClassificationOption = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  archived: z.boolean(),
  /** Original free-text tag, kept forever so existing Yjs documents need no rewrite. */
  legacy: z.string().max(40).optional(),
});
export type ClassificationOption = z.infer<typeof ClassificationOption>;
const defaults = (codes: readonly string[], labels: readonly string[]) =>
  codes.map((id, i) => ({ id, label: labels[i] as string, archived: false }));
/**
 * The storyboard lists. A frame stores the id of a value or text the person typed, so renaming
 * or archiving a value rewrites no document. Until a default is renamed, clients translate it:
 * the label here is only the marker that it was not renamed.
 */
export const DEFAULT_SHOT_CATALOGS = {
  shotSizes: defaults(SHOT_SIZES, [
    'Extreme wide',
    'Wide',
    'Full',
    'Medium',
    'Medium close-up',
    'Close-up',
    'Extreme close-up',
    'Insert',
  ]),
  shotAngles: defaults(SHOT_ANGLES, [
    'Eye level',
    'High angle',
    'Low angle',
    'Overhead',
    'Dutch',
    'POV',
    'Over the shoulder',
  ]),
  shotMovements: defaults(SHOT_MOVEMENTS, [
    'Static',
    'Pan',
    'Tilt',
    'Dolly',
    'Truck',
    'Crane',
    'Handheld',
    'Steadicam',
    'Drone',
    'Zoom',
  ]),
};
export type ShotCatalogKey = keyof typeof DEFAULT_SHOT_CATALOGS;
export const SHOT_CATALOG_KEYS = Object.keys(DEFAULT_SHOT_CATALOGS) as ShotCatalogKey[];
const shotCatalog = (key: ShotCatalogKey) =>
  z
    .array(ClassificationOption)
    .max(200)
    .default(() => structuredClone(DEFAULT_SHOT_CATALOGS[key]));
export const ShotCatalogs = z.object({
  shotSizes: shotCatalog('shotSizes'),
  shotAngles: shotCatalog('shotAngles'),
  shotMovements: shotCatalog('shotMovements'),
});
export type ShotCatalogs = z.infer<typeof ShotCatalogs>;
export const ClassificationCatalogs = ShotCatalogs.extend({
  revision: z.int().min(0),
  projectTypes: z.array(ClassificationOption).max(200),
  tags: z.array(ClassificationOption).max(500),
}).openapi('ClassificationCatalogs');
export type ClassificationCatalogs = z.infer<typeof ClassificationCatalogs>;
export const DEFAULT_CLASSIFICATIONS: ClassificationCatalogs = {
  revision: 0,
  projectTypes: [
    ['short_film', 'Short film'],
    ['commercial', 'Commercial'],
    ['music_video', 'Music video'],
    ['photo_shoot', 'Photo shoot'],
    ['documentary', 'Documentary'],
  ].map(([id, label]) => ({ id: id as string, label: label as string, archived: false })),
  tags: [],
  ...DEFAULT_SHOT_CATALOGS,
};
/** The id of a value added to a catalog; the id of a default value is a readable code. */
export const CATALOG_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function classificationOption(options: readonly ClassificationOption[], value: string) {
  const key = value.trim().toLowerCase();
  return options.find((o) => o.id.toLowerCase() === key || o.legacy === key);
}
export function classificationLabel(options: readonly ClassificationOption[], value: string) {
  return classificationOption(options, value)?.label ?? value;
}
