import {
  type ClassificationCatalogs,
  type ClassificationOption,
  DEFAULT_SHOT_CATALOGS,
  SHOT_CATALOG_KEYS,
  type ShotCatalogKey,
} from '@inkadra/shared';
import { Button, Icon, IconButton } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { isRenamedDefault, setClassifications, shotOptionLabel } from '../lib/classifications.ts';
import './classification-settings.css';

type CatalogKey = 'projectTypes' | 'tags' | ShotCatalogKey;
const GROUPS: { title: string; keys: CatalogKey[] }[] = [
  { title: 'projects', keys: ['projectTypes', 'tags'] },
  { title: 'storyboard', keys: SHOT_CATALOG_KEYS },
];
const ALL_KEYS = GROUPS.flatMap((g) => g.keys);
const SUMMARY_CHIPS = 6;

const isShot = (key: CatalogKey): key is ShotCatalogKey =>
  (SHOT_CATALOG_KEYS as string[]).includes(key);

/** The defaults that "Restore" brings back: missing or archived, never a renamed one. */
function restoredDefaults(key: ShotCatalogKey, options: ClassificationOption[]) {
  const next = options.map((o) =>
    o.archived && DEFAULT_SHOT_CATALOGS[key].some((d) => d.id === o.id) && !isRenamedDefault(key, o)
      ? { ...o, archived: false }
      : o,
  );
  for (const original of DEFAULT_SHOT_CATALOGS[key])
    if (!next.some((o) => o.id === original.id)) next.push({ ...original });
  return next;
}

/** Settings → Classifications: one page of closable catalogs, in two groups. */
export function ClassificationSettings() {
  const { t } = useTranslation();
  const [saved, setSavedCatalogs] = useState<ClassificationCatalogs | null>(null);
  const [draft, setDraft] = useState<ClassificationCatalogs | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<CatalogKey>>(new Set());
  // An empty name is an error only once the person tries to save: a new row starts empty.
  const [triedSaving, setTriedSaving] = useState(false);
  // The input that takes the focus once it renders: a value just added, or the first error.
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
  const update = (key: CatalogKey, options: ClassificationOption[]) => {
    if (!draft) return;
    setJustSaved(false);
    setDraft({ ...draft, [key]: options });
  };
  const nameOf = (key: CatalogKey, option: ClassificationOption) =>
    isShot(key) ? shotOptionLabel(key, option, t) : option.label;
  /** Same rule as the server: a name cannot be another value's name, id or original tag. */
  const problemOf = (
    key: CatalogKey,
    option: ClassificationOption,
    all: ClassificationOption[],
  ) => {
    const name = nameOf(key, option).trim().toLowerCase();
    if (!name) return triedSaving ? 'required' : null;
    const taken = all.some(
      (o) =>
        o.id !== option.id &&
        (nameOf(key, o).trim().toLowerCase() === name ||
          o.label.trim().toLowerCase() === name ||
          o.id.toLowerCase() === name ||
          o.legacy === name),
    );
    return taken ? 'duplicate' : null;
  };
  const firstProblem = (catalogs: ClassificationCatalogs) => {
    for (const key of ALL_KEYS)
      for (const option of catalogs[key])
        if (!nameOf(key, option).trim() || problemOf(key, option, catalogs[key]))
          return { key, id: option.id };
    return null;
  };

  return (
    <div className="catalogs" data-tour="classifications">
      {error && (
        <div role="alert" className="catalogs__error">
          <div>
            <b>{t('catalogs.errorTitle')}</b>
            <p>{t('catalogs.error')}</p>
          </div>
          <Button onClick={() => void load()}>{t('catalogs.reload')}</Button>
        </div>
      )}
      {!draft && !error && (
        <div className="catalogs__loading" aria-busy="true">
          <div className="ink-skeleton" />
          <div className="ink-skeleton" />
          <div className="ink-skeleton" />
        </div>
      )}
      {draft && (
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setTriedSaving(true);
            const problem = firstProblem(draft);
            if (problem) {
              focusId.current = problem.id;
              setOpen(new Set(open).add(problem.key));
              return;
            }
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
              setTriedSaving(false);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="catalogs__grid">
            {GROUPS.map((group) => (
              <div key={group.title} className="catalogs__group">
                <h2 className="catalogs__group-title">{t(`catalogs.groups.${group.title}`)}</h2>
                <div className="settings-card">
                  {group.keys.map((key) => {
                    const options = draft[key];
                    const archived = options.filter((o) => o.archived).length;
                    const active = options.filter((o) => !o.archived);
                    const expanded = open.has(key);
                    const bodyId = `catalog-${key}`;
                    const restored = isShot(key) ? restoredDefaults(key, options) : null;
                    const emptyText = isShot(key) ? t('catalogs.emptyShots') : t('catalogs.empty');
                    return (
                      <section key={key} className="catalogs__card">
                        <h3 className="catalogs__head">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={expanded ? bodyId : undefined}
                            onClick={() => {
                              const next = new Set(open);
                              if (expanded) next.delete(key);
                              else next.add(key);
                              setOpen(next);
                            }}
                          >
                            <span className="catalogs__name-head">{t(`catalogs.${key}`)}</span>
                            <span className="ink-muted catalogs__count">
                              {t('catalogs.active', { count: active.length })}
                              {archived > 0 &&
                                ` · ${t('catalogs.archivedCount', { count: archived })}`}
                            </span>
                            <Icon
                              name="chevronDown"
                              size={14}
                              className={`ink-icon catalogs__chevron${expanded ? ' is-open' : ''}`}
                            />
                          </button>
                        </h3>
                        {!expanded &&
                          (active.length === 0 ? (
                            <p className="ink-muted catalogs__empty">{emptyText}</p>
                          ) : (
                            <div className="catalogs__chips">
                              {active.slice(0, SUMMARY_CHIPS).map((o) => (
                                <span key={o.id} className="catalogs__chip">
                                  {nameOf(key, o)}
                                </span>
                              ))}
                              {active.length > SUMMARY_CHIPS && (
                                <span className="catalogs__chip">
                                  +{active.length - SUMMARY_CHIPS}
                                </span>
                              )}
                            </div>
                          ))}
                        {expanded && (
                          <div id={bodyId} className="catalogs__body">
                            {active.length === 0 && (
                              <p className="ink-muted catalogs__empty">{emptyText}</p>
                            )}
                            {options.length > 0 && (
                              <ol className="catalogs__list">
                                {options.map((option, index) => {
                                  const name = nameOf(key, option);
                                  const problem = problemOf(key, option, options);
                                  const hintId = `catalog-hint-${option.id}`;
                                  return (
                                    <li key={option.id}>
                                      <div
                                        className={`catalogs__row${option.archived ? ' is-archived' : ''}`}
                                      >
                                        <span className="catalogs__move">
                                          {([-1, 1] as const).map((delta) => (
                                            <IconButton
                                              key={delta}
                                              icon="chevronDown"
                                              className={delta < 0 ? 'catalogs__up' : undefined}
                                              label={t(
                                                delta < 0 ? 'catalogs.up' : 'catalogs.down',
                                                {
                                                  name,
                                                },
                                              )}
                                              disabled={
                                                busy ||
                                                index + delta < 0 ||
                                                index + delta >= options.length
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
                                          className={`ink-input catalogs__name${problem ? ' is-invalid' : ''}`}
                                          aria-label={t('catalogs.name')}
                                          aria-invalid={!!problem}
                                          aria-describedby={problem ? hintId : undefined}
                                          placeholder={t('catalogs.name')}
                                          value={name}
                                          maxLength={40}
                                          disabled={busy}
                                          ref={(el) => {
                                            if (el && focusId.current === option.id) {
                                              focusId.current = null;
                                              el.focus();
                                            }
                                          }}
                                          onChange={(e) => {
                                            const original =
                                              isShot(key) &&
                                              DEFAULT_SHOT_CATALOGS[key].find(
                                                (d) => d.id === option.id,
                                              );
                                            // Typing the translation again undoes the rename.
                                            // shortcut: typing a default's English name on an
                                            // Italian page does the same; nobody needs it so far.
                                            const label =
                                              original &&
                                              e.target.value ===
                                                shotOptionLabel(key as ShotCatalogKey, original, t)
                                                ? original.label
                                                : e.target.value;
                                            update(
                                              key,
                                              options.map((o) =>
                                                o.id === option.id ? { ...o, label } : o,
                                              ),
                                            );
                                          }}
                                        />
                                        {isShot(key) && isRenamedDefault(key, option) && (
                                          <span className="catalogs__badge is-renamed">
                                            {t('catalogs.renamed')}
                                          </span>
                                        )}
                                        {option.archived && (
                                          <span className="catalogs__badge">
                                            {t('catalogs.archived')}
                                          </span>
                                        )}
                                        <Button
                                          variant="ghost"
                                          aria-pressed={option.archived}
                                          disabled={busy}
                                          onClick={() =>
                                            update(
                                              key,
                                              options.map((o) =>
                                                o.id === option.id
                                                  ? { ...o, archived: !o.archived }
                                                  : o,
                                              ),
                                            )
                                          }
                                        >
                                          {t(
                                            option.archived
                                              ? 'catalogs.restore'
                                              : 'catalogs.archive',
                                          )}
                                        </Button>
                                      </div>
                                      {problem && (
                                        <p id={hintId} className="catalogs__hint">
                                          {t(`catalogs.${problem}`)}
                                        </p>
                                      )}
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                            <div className="catalogs__actions">
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
                              {restored && (
                                <Button
                                  variant="ghost"
                                  disabled={
                                    busy || JSON.stringify(restored) === JSON.stringify(options)
                                  }
                                  onClick={() => update(key, restored)}
                                >
                                  {t('catalogs.restoreDefaults')}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* Manual save (decision 0124): the bar shows only when there is something to save. */}
          {dirty ? (
            <div className="catalogs__bar">
              <span role="status">{t('catalogs.unsaved')}</span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(saved);
                  setJustSaved(false);
                  setTriedSaving(false);
                }}
              >
                {t('catalogs.discard')}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t(busy ? 'settingsUi.autosave.saving' : 'settings.save')}
              </Button>
            </div>
          ) : (
            <p className="catalogs__saved ink-muted" role="status">
              {justSaved ? t('settings.saved') : ''}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
