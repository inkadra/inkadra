import {
  type ClassificationCatalogs,
  classificationLabel,
  classificationOption,
  DEFAULT_CLASSIFICATIONS,
} from '@inkadra/shared';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api.ts';

let cache = DEFAULT_CLASSIFICATIONS;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
export function setClassifications(value: ClassificationCatalogs) {
  cache = value;
  for (const listener of listeners) listener();
}
export function refreshClassifications() {
  if (!pending)
    pending = api
      .get<ClassificationCatalogs>('/instance/classifications')
      .then(setClassifications)
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
  return pending;
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useClassifications() {
  const { t } = useTranslation();
  const catalogs = useSyncExternalStore(subscribe, () => cache);
  useEffect(() => {
    void refreshClassifications();
    const refresh = () => {
      void refreshClassifications();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
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
