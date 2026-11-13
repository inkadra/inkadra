// SPDX-License-Identifier: MPL-2.0
import type { BoardKind, BoardOptionalView } from './boards.ts';
import type { NotificationChannelType } from './notifications.ts';

/**
 * Modules (decision 0121): parts of Inkadra a person can turn off for themselves in Settings →
 * Modules. Board (notes, images, links, files, to-dos, columns, comments) is always on.
 */
export const MODULE_IDS = ['storyboard', 'production', 'moodboard', 'review', 'plan'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** What a module owns, by the names each surface already uses. */
export interface ModuleParts {
  /** Board kinds the module creates. */
  kinds: readonly BoardKind[];
  /** Optional views of a board. */
  views: readonly BoardOptionalView[];
  /** Canvas tools: the bar, the More menu, the palette and the keys. */
  tools: readonly string[];
  /** Other menu entries that create something of the module. */
  menus: readonly string[];
  /** Tutorials (tours.ts ids). */
  tours: readonly string[];
  /** Rows of the notification settings. */
  notifications: readonly NotificationChannelType[];
  /** Contents and options of the export dialog. */
  exports: readonly string[];
  /** Events of the personal calendar feed, and their rows in its settings card. */
  calendar: readonly string[];
}
export type ModulePart = keyof ModuleParts;

/**
 * The one registry every surface reads: a new feature of a module is added here, not to each
 * surface.
 */
export const MODULES: Record<ModuleId, ModuleParts> = {
  storyboard: {
    kinds: ['storyboard'],
    views: ['shotlist'],
    tools: ['frame', 'scene', 'storyboard'],
    menus: ['sendToStoryboard', 'screenplayImport'],
    tours: ['storyboard', 'draw', 'shotlist'],
    notifications: [],
    exports: [],
    calendar: [],
  },
  production: {
    kinds: ['production'],
    views: [],
    tools: [],
    menus: [],
    tours: ['schedule', 'troupe'],
    notifications: [],
    exports: ['scenesheets', 'callSheet', 'callsheets'],
    // Off leaves shooting days out of the feed; they stay in Production and come back with it.
    calendar: ['shooting'],
  },
  moodboard: {
    kinds: ['moodboard'],
    views: ['moodboard'],
    tools: [],
    menus: [],
    tours: ['moodboard'],
    notifications: [],
    exports: [],
    calendar: [],
  },
  review: {
    kinds: [],
    views: ['review'],
    tools: [],
    menus: ['reviewLink'],
    tours: ['review'],
    notifications: ['review'],
    exports: ['approvedOnly'],
    calendar: [],
  },
  plan: {
    kinds: [],
    views: [],
    tools: ['plan'],
    menus: ['newScenePlan'],
    tours: ['setplan', 'setplanLinks', 'setplanOutputs'],
    notifications: [],
    exports: [],
    calendar: [],
  },
};

/** The module that owns a name of one part, or null when it belongs to Board (always on). */
export function moduleOf(part: ModulePart, name: string): ModuleId | null {
  return MODULE_IDS.find((id) => (MODULES[id][part] as readonly string[]).includes(name)) ?? null;
}

/** Whether something is offered to a person with these modules off. */
export function offered(off: readonly string[], part: ModulePart, name: string): boolean {
  const owner = moduleOf(part, name);
  return !owner || !off.includes(owner);
}

/**
 * The list of modules off to save after turning one on or off. Names this app does not know,
 * saved by a newer one, are kept.
 */
export function switchModule(off: readonly string[], id: ModuleId, on: boolean): string[] {
  const rest = off.filter((m) => m !== id);
  return on ? rest : [...rest, id];
}
