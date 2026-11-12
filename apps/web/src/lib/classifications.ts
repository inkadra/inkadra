import {
  ClassificationCatalogs,
  type ClassificationOption,
  classificationLabel,
  classificationOption,
  DEFAULT_CLASSIFICATIONS,
  type ShotCatalogKey,
  type ShotCatalogs,
} from '@inkadra/shared';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api.ts';

/** What a shot field reads as is the same on every client (decision 0116). */
export { isRenamedDefault, shotOptionLabel, shotText } from '@inkadra/shared';

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
