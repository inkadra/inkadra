import { type ModuleId, type ModulePart, offered, switchModule } from '@inkadra/shared';
import { type IconName, kindStyle, toolStyle } from '@inkadra/ui';
import { type CSSProperties, useCallback } from 'react';
import { getPreferences, updatePreferences, usePreferences } from './preferences.ts';

/**
 * The person's modules (decision 0121). Off hides the ways to create, never the data: a
 * surface asks `offers(part, name)` before offering a kind, a view, a tool, a menu entry, a
 * tour, a notification row or an export content. The server refuses nothing; only the calendar
 * feed, which no app filters, leaves out the events of a module that is off (#676).
 */
export function useModules() {
  const off = usePreferences().modulesOff;
  const offers = useCallback((part: ModulePart, name: string) => offered(off, part, name), [off]);
  const isOn = useCallback((id: ModuleId) => !off.includes(id), [off]);
  return { off, offers, isOn };
}

/** Turns a module on or off for the signed-in person, saved with their preferences. */
export function setModule(id: ModuleId, on: boolean): Promise<void> {
  return updatePreferences({ modulesOff: switchModule(getPreferences().modulesOff, id, on) });
}

/**
 * Whether the one short notice of a module is still to show (decision 0121), and marks it
 * shown: it shows once per module per person.
 */
export function takeModuleNotice(id: ModuleId): boolean {
  const seen = getPreferences().moduleNotices;
  if (seen.includes(id)) return false;
  void updatePreferences({ moduleNotices: [...seen, id] }).catch(() => {});
  return true;
}

/** The icon of a module and its colour, as its kind, view or tool has elsewhere. */
export const MODULE_GLYPHS: Record<ModuleId, { icon: IconName; style: CSSProperties }> = {
  storyboard: { icon: 'storyboard', style: kindStyle('storyboard') },
  production: { icon: 'film', style: kindStyle('production') },
  moodboard: { icon: 'image', style: kindStyle('moodboard') },
  review: { icon: 'comment', style: kindStyle('review') },
  plan: { icon: 'planCamera', style: toolStyle('plan') },
};
