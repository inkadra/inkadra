// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';

export const ClassificationOption = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  archived: z.boolean(),
  /** Original free-text tag, kept forever so existing Yjs documents need no rewrite. */
  legacy: z.string().max(40).optional(),
});
export type ClassificationOption = z.infer<typeof ClassificationOption>;
export const ClassificationCatalogs = z
  .object({
    revision: z.int().min(0),
    projectTypes: z.array(ClassificationOption).max(200),
    tags: z.array(ClassificationOption).max(500),
  })
  .openapi('ClassificationCatalogs');
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
};
export function classificationOption(options: readonly ClassificationOption[], value: string) {
  const key = value.trim().toLowerCase();
  return options.find((o) => o.id.toLowerCase() === key || o.legacy === key);
}
export function classificationLabel(options: readonly ClassificationOption[], value: string) {
  return classificationOption(options, value)?.label ?? value;
}
