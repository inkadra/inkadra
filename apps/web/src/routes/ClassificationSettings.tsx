import type { ClassificationCatalogs } from '@inkadra/shared';
import { Button, IconButton } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { setClassifications } from '../lib/classifications.ts';
import './classification-settings.css';

type CatalogKey = 'projectTypes' | 'tags';
const KEYS: CatalogKey[] = ['projectTypes', 'tags'];

/** Settings → Classifications: the shared project types and tags, one card each. */
export function ClassificationSettings() {
  const { t } = useTranslation();
  const [saved, setSavedCatalogs] = useState<ClassificationCatalogs | null>(null);
  const [draft, setDraft] = useState<ClassificationCatalogs | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // The input of a value just added takes the focus once it renders.
  const focusId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const catalogs = await api.get<ClassificationCatalogs>('/instance/classifications');
      setSavedCatalogs(catalogs);
      setDraft(catalogs);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (key: CatalogKey, options: ClassificationCatalogs[CatalogKey]) => {
    if (!draft) return;
    setJustSaved(false);
    setDraft({ ...draft, [key]: options });
  };

  return (
    <div className="catalogs">
      {error && (
        <p role="alert" className="catalogs__error">
          {t('catalogs.error')} <Button onClick={() => void load()}>{t('catalogs.reload')}</Button>
        </p>
      )}
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            setJustSaved(false);
            try {
              const result = await api.put<ClassificationCatalogs>(
                '/instance/classifications',
                draft,
              );
              setSavedCatalogs(result);
              setDraft(result);
              setClassifications(result);
              setJustSaved(true);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="catalogs__grid">
            {KEYS.map((key) => {
              const options = draft[key];
              const archived = options.filter((o) => o.archived).length;
              const headingId = `catalog-${key}`;
              return (
                <section key={key} className="catalogs__card" aria-labelledby={headingId}>
                  <header className="catalogs__head">
                    <h2 id={headingId}>{t(`catalogs.${key}`)}</h2>
                    <span className="ink-muted">
                      {t('catalogs.active', { count: options.length - archived })}
                      {archived > 0 && ` · ${t('catalogs.archivedCount', { count: archived })}`}
                    </span>
                  </header>
                  {options.length === 0 ? (
                    <p className="ink-muted catalogs__empty">{t('catalogs.empty')}</p>
                  ) : (
                    <ol className="catalogs__list">
                      {options.map((option, index) => (
                        <li
                          key={option.id}
                          className={`catalogs__row${option.archived ? ' is-archived' : ''}`}
                        >
                          <span className="catalogs__move">
                            {([-1, 1] as const).map((delta) => (
                              <IconButton
                                key={delta}
                                icon="chevronDown"
                                className={delta < 0 ? 'catalogs__up' : undefined}
                                label={t(delta < 0 ? 'catalogs.up' : 'catalogs.down', {
                                  name: option.label,
                                })}
                                disabled={
                                  busy || index + delta < 0 || index + delta >= options.length
                                }
                                onClick={() => {
                                  const next = [...options];
                                  const other = next[index + delta];
                                  if (!other) return;
                                  next[index] = other;
                                  next[index + delta] = option;
                                  update(key, next);
                                }}
                              />
                            ))}
                          </span>
                          <input
                            className="ink-input catalogs__name"
                            aria-label={t('catalogs.name')}
                            placeholder={t('catalogs.name')}
                            value={option.label}
                            maxLength={40}
                            required
                            disabled={busy}
                            ref={(el) => {
                              if (el && focusId.current === option.id) {
                                focusId.current = null;
                                el.focus();
                              }
                            }}
                            onChange={(e) =>
                              update(
                                key,
                                options.map((o) =>
                                  o.id === option.id ? { ...o, label: e.target.value } : o,
                                ),
                              )
                            }
                          />
                          {option.archived && (
                            <span className="catalogs__badge">{t('catalogs.archived')}</span>
                          )}
                          <Button
                            variant="ghost"
                            aria-pressed={option.archived}
                            disabled={busy}
                            onClick={() =>
                              update(
                                key,
                                options.map((o) =>
                                  o.id === option.id ? { ...o, archived: !o.archived } : o,
                                ),
                              )
                            }
                          >
                            {t(option.archived ? 'catalogs.restore' : 'catalogs.archive')}
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}
                  <Button
                    variant="ghost"
                    icon="plus"
                    className="catalogs__add"
                    disabled={busy}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      focusId.current = id;
                      update(key, [...options, { id, label: '', archived: false }]);
                    }}
                  >
                    {t('catalogs.add')}
                  </Button>
                </section>
              );
            })}
          </div>
          <div className="catalogs__bar">
            <span className="ink-muted" role="status">
              {dirty ? t('catalogs.unsaved') : justSaved ? t('settings.saved') : ''}
            </span>
            {dirty && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(saved);
                  setJustSaved(false);
                }}
              >
                {t('catalogs.discard')}
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={busy || !dirty}>
              {t('settings.save')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
