import {
  CATALOG_UUID,
  ClassificationCatalogs,
  type ClassificationOption,
  classificationLabel,
  classificationOption,
  DEFAULT_CLASSIFICATIONS,
  DEFAULT_SHOT_CATALOGS,
  type ShotCatalogKey,
  type ShotCatalogs,
} from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api.ts';

let cache = DEFAULT_CLASSIFICATIONS;
let pending: Promise<void> | null = null;
let lastRefresh = 0;
/** The guest page reads its lists from the link, never from an account endpoint. */
let guest = false;
export function useGuestShotCatalogs(shotCatalogs: ShotCatalogs | undefined) {
  useEffect(() => {
    guest = true;
    return () => {
      guest = false;
    };
  }, []);
  useEffect(() => {
    if (shotCatalogs) setClassifications({ ...cache, ...shotCatalogs });
  }, [shotCatalogs]);
}
const listeners = new Set<() => void>();
export function setClassifications(value: ClassificationCatalogs) {
  cache = value;
  for (const listener of listeners) listener();
}
export const getClassifications = () => cache;
export function refreshClassifications() {
  if (guest) return Promise.resolve();
  lastRefresh = Date.now();
  if (!pending)
    pending = api
      .get<ClassificationCatalogs>('/instance/classifications')
      .then((value) => setClassifications(ClassificationCatalogs.parse(value)))
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
  return pending;
}
/**
 * Adds a value to a catalog from where it is used, for an administrator; the server refuses anyone
 * else. Reads the catalogs first, as the update must carry the current revision. A value that
 * exists under that name is returned as it is.
 */
export async function addClassification(key: 'tags' | ShotCatalogKey, label: string) {
  const current = ClassificationCatalogs.parse(
    await api.get<ClassificationCatalogs>('/instance/classifications'),
  );
  const name = label.trim().slice(0, 40);
  const known = current[key].find((o) => o.label.toLowerCase() === name.toLowerCase());
  if (known) {
    setClassifications(current);
    return known;
  }
  const id = crypto.randomUUID();
  const next = ClassificationCatalogs.parse(
    await api.put<ClassificationCatalogs>('/instance/classifications', {
      ...current,
      [key]: [...current[key], { id, label: name, archived: false }],
    }),
  );
  setClassifications(next);
  return next[key].find((o) => o.id === id) as ClassificationOption;
}
const onFocus = () => {
  void refreshClassifications();
};
const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('focus', onFocus);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('focus', onFocus);
  };
};
const I18N_PREFIX: Record<ShotCatalogKey, string> = {
  shotSizes: 'film.shot',
  shotAngles: 'film.angle',
  shotMovements: 'film.movement',
};
export function isRenamedDefault(key: ShotCatalogKey, option: ClassificationOption) {
  const original = DEFAULT_SHOT_CATALOGS[key].find((o) => o.id === option.id);
  return !!original && original.label !== option.label;
}
/** A default value is translated until it is renamed; any other value has its one name. */
export function shotOptionLabel(key: ShotCatalogKey, option: ClassificationOption, t: TFunction) {
  const isDefault = DEFAULT_SHOT_CATALOGS[key].some((o) => o.id === option.id);
  return isDefault && !isRenamedDefault(key, option)
    ? t(`${I18N_PREFIX[key]}.${option.id}`)
    : option.label;
}
/** What a frame field reads as: the name of its catalog value, archived too, or its free text. */
export function shotText(
  catalogs: ShotCatalogs,
  key: ShotCatalogKey,
  value: string | undefined,
  t: TFunction,
) {
  if (!value) return '';
  const option = catalogs[key].find((o) => o.id === value);
  if (option) return shotOptionLabel(key, option, t);
  // A value of a catalog not loaded yet: never show its id.
  return CATALOG_UUID.test(value) ? '' : value;
}
/**
 * The lists alone, for the many small things that read them (a card per frame): subscribing
 * costs nothing, and a burst of mounts asks the server once.
 */
export function useShotCatalogs(): ShotCatalogs {
  const catalogs = useSyncExternalStore(
    subscribe,
    () => cache,
    () => DEFAULT_CLASSIFICATIONS,
  );
  useEffect(() => {
    if (Date.now() - lastRefresh > 60_000) void refreshClassifications();
  }, []);
  return catalogs;
}
export function useClassifications() {
  const { t } = useTranslation();
  const catalogs = useSyncExternalStore(
    subscribe,
    () => cache,
    () => DEFAULT_CLASSIFICATIONS,
  );
  useEffect(() => {
    void refreshClassifications();
  }, []);
  return useMemo(
    () => ({
      catalogs,
      tagLabel: (value: string) => classificationLabel(catalogs.tags, value),
      tagOption: (value: string) => classificationOption(catalogs.tags, value),
      typeLabel: (value: string) => {
        const option = catalogs.projectTypes.find((o) => o.id === value);
        const original = DEFAULT_CLASSIFICATIONS.projectTypes.find((o) => o.id === value);
        return original && option?.label === original.label
          ? t(`onboarding.types.${value}`)
          : (option?.label ?? value);
      },
    }),
    [catalogs, t],
  );
}
