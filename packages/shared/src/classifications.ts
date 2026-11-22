// SPDX-License-Identifier: MPL-2.0
import {
  CATALOG_UUID,
  SHOT_ANGLES,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
  TODO_LISTS,
} from '@inkadra/doc-schema';
import { z } from './common.ts';
import type { Words } from './shot-words.ts';

export const ClassificationOption = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  archived: z.boolean(),
  /** Original free-text tag, kept forever so existing Yjs documents need no rewrite. */
  legacy: z.string().max(40).optional(),
  /**
   * How many projects (types) or board elements (tags, storyboard values) use the value: for
   * administrators, on `GET ?uses=true` and on save; absent where it cannot be counted
   * (decision 0126). Ignored in a request body.
   */
  uses: z.int().min(0).optional(),
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
/**
 * The kinds of to-do lists (decisions 0058, 0136): a to-do card stores the id, a default's code
 * or the UUID of a kind added here. Translated like the storyboard defaults until renamed.
 */
export const DEFAULT_TODO_LISTS = defaults(TODO_LISTS, ['Wardrobe', 'Props', 'Equipment']);
/** Every catalog whose defaults clients translate until they are renamed. */
export const TRANSLATED_DEFAULTS = { ...DEFAULT_SHOT_CATALOGS, todoLists: DEFAULT_TODO_LISTS };
export type TranslatedCatalogKey = keyof typeof TRANSLATED_DEFAULTS;
export const TRANSLATED_CATALOG_KEYS = Object.keys(TRANSLATED_DEFAULTS) as TranslatedCatalogKey[];
const translatedCatalog = (key: TranslatedCatalogKey) =>
  z
    .array(ClassificationOption)
    .max(200)
    .default(() => structuredClone(TRANSLATED_DEFAULTS[key]));
/** The lists a board reads, which guests get with their link too. */
export const ShotCatalogs = z.object({
  shotSizes: translatedCatalog('shotSizes'),
  shotAngles: translatedCatalog('shotAngles'),
  shotMovements: translatedCatalog('shotMovements'),
  /** Absent on servers before decision 0136: the three defaults. */
  todoLists: translatedCatalog('todoLists'),
});
export type ShotCatalogs = z.infer<typeof ShotCatalogs>;
export const ClassificationCatalogs = ShotCatalogs.extend({
  revision: z.int().min(0),
  projectTypes: z.array(ClassificationOption).max(200),
  tags: z.array(ClassificationOption).max(500),
}).openapi('ClassificationCatalogs');
export type ClassificationCatalogs = z.infer<typeof ClassificationCatalogs>;
export const ClassificationsQuery = z.object({
  /** `true`: an administrator also gets `uses` on each value (decision 0126). */
  uses: z.enum(['true']).optional(),
});
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
  ...structuredClone(TRANSLATED_DEFAULTS),
};
/**
 * Servers that advertise it let an administrator remove a value that nothing uses
 * (decision 0126): a save without that id. Older servers reject any removal.
 */
export const CLASSIFICATION_DELETE_CAPABILITY = 'classification-delete';
/**
 * Servers that advertise it keep the `todoLists` catalog (decision 0136) and leave it as it is
 * when a save leaves it out, as clients before it do.
 */
export const TODO_LIST_CATALOG_CAPABILITY = 'todo-list-catalog';
export { CATALOG_UUID };
/** A value that may be removed: added on this instance (decision 0126) and used nowhere. */
export function canDeleteClassification(option: ClassificationOption) {
  return CATALOG_UUID.test(option.id) && option.uses === 0;
}
export function classificationOption(options: readonly ClassificationOption[], value: string) {
  const key = value.trim().toLowerCase();
  return options.find((o) => o.id.toLowerCase() === key || o.legacy === key);
}
export function classificationLabel(options: readonly ClassificationOption[], value: string) {
  return classificationOption(options, value)?.label ?? value;
}
/** Where the words of a default value are, by catalog (`film.shot.ws`, see `SHOT_WORDS_EN`). */
const SHOT_WORDS_KEY: Record<TranslatedCatalogKey, string> = {
  shotSizes: 'film.shot',
  shotAngles: 'film.angle',
  shotMovements: 'film.movement',
  todoLists: 'board.todo.lists',
};
export function isRenamedDefault(key: TranslatedCatalogKey, option: ClassificationOption) {
  const original = TRANSLATED_DEFAULTS[key].find((o) => o.id === option.id);
  return !!original && original.label !== option.label;
}
/** A default value is translated until it is renamed; any other value has its one name. */
export function shotOptionLabel(key: TranslatedCatalogKey, option: ClassificationOption, t: Words) {
  const isDefault = TRANSLATED_DEFAULTS[key].some((o) => o.id === option.id);
  return isDefault && !isRenamedDefault(key, option)
    ? t(`${SHOT_WORDS_KEY[key]}.${option.id}`)
    : option.label;
}
/**
 * The name of a to-do list's kind: its catalog value, archived too. A kind of a catalog not loaded
 * yet reads as its default's word, or as nothing, never as its id.
 */
export function todoListLabel(catalogs: Pick<ShotCatalogs, 'todoLists'>, list: string, t: Words) {
  const option =
    catalogs.todoLists.find((o) => o.id === list) ?? DEFAULT_TODO_LISTS.find((o) => o.id === list);
  return option ? shotOptionLabel('todoLists', option, t) : '';
}
/** Kinds in the order of the catalog; one it does not know goes last. */
export function todoListOrder(catalogs: Pick<ShotCatalogs, 'todoLists'>) {
  const ids = catalogs.todoLists.map((o) => o.id);
  return (list: string) => {
    const i = ids.indexOf(list);
    return i < 0 ? ids.length : i;
  };
}
/** What a frame field reads as: the name of its catalog value, archived too, or its free text. */
export function shotText(
  catalogs: ShotCatalogs,
  key: ShotCatalogKey,
  value: string | undefined,
  t: Words,
) {
  if (!value) return '';
  const option = catalogs[key].find((o) => o.id === value);
  if (option) return shotOptionLabel(key, option, t);
  // A value of a catalog not loaded yet: never show its id.
  return CATALOG_UUID.test(value) ? '' : value;
}
