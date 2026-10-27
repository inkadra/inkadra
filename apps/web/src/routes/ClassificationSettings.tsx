import type { ClassificationCatalogs } from '@inkadra/shared';
import { Button, TextField } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { setClassifications } from '../lib/classifications.ts';

export function ClassificationSettings() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ClassificationCatalogs | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setDraft(await api.get<ClassificationCatalogs>('/instance/classifications'));
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="settings__section">
      <h2>{t('catalogs.title')}</h2>
      <p>{t('catalogs.scope')}</p>
      {error && (
        <p role="alert">
          {t('catalogs.error')} <Button onClick={() => void load()}>{t('catalogs.reload')}</Button>
        </p>
      )}
      {draft && (
        <form
          className="settings__form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            setSaved(false);
            try {
              const result = await api.put<ClassificationCatalogs>(
                '/instance/classifications',
                draft,
              );
              setDraft(result);
              setClassifications(result);
              setSaved(true);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {(['projectTypes', 'tags'] as const).map((key) => (
            <fieldset key={key} disabled={busy}>
              <legend>{t(`catalogs.${key}`)}</legend>
              {draft[key].map((option, index) => (
                <div key={option.id} className="settings__actions">
                  <TextField
                    label={t('catalogs.name')}
                    value={option.label}
                    maxLength={40}
                    required
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [key]: draft[key].map((o) =>
                          o.id === option.id ? { ...o, label: e.target.value } : o,
                        ),
                      })
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={option.archived}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: draft[key].map((o) =>
                            o.id === option.id ? { ...o, archived: e.target.checked } : o,
                          ),
                        })
                      }
                    />
                    {t('catalogs.archived')}
                  </label>
                  {([-1, 1] as const).map((delta) => (
                    <Button
                      key={delta}
                      type="button"
                      aria-label={t(delta < 0 ? 'catalogs.up' : 'catalogs.down', {
                        name: option.label,
                      })}
                      disabled={index + delta < 0 || index + delta >= draft[key].length}
                      onClick={() => {
                        const options = [...draft[key]];
                        const other = options[index + delta];
                        if (!other) return;
                        options[index] = other;
                        options[index + delta] = option;
                        setDraft({ ...draft, [key]: options });
                      }}
                    >
                      {delta < 0 ? '↑' : '↓'}
                    </Button>
                  ))}
                </div>
              ))}
              <Button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    [key]: [...draft[key], { id: crypto.randomUUID(), label: '', archived: false }],
                  })
                }
              >
                {t('catalogs.add')}
              </Button>
            </fieldset>
          ))}
          <Button type="submit" variant="primary" disabled={busy}>
            {t('settings.save')}
          </Button>
          {saved && <p role="status">{t('settings.saved')}</p>}
        </form>
      )}
    </section>
  );
}
