import type { Board, Project, SearchHit, SearchResult, TagCount } from '@inkadra/shared';
import { Icon, type IconName, KeyCap } from '@inkadra/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { boardPath } from '../board/boards.ts';
import { loadTagsForProjects, normaliseTag } from '../board/tags.tsx';
import { type PaletteAction, rankActions, useContextActions } from '../commands/actions.ts';
import { api } from '../lib/api.ts';
import { useClassifications } from '../lib/classifications.ts';
import { loadProjects } from './projects.ts';
import './search.css';

const DEBOUNCE_MS = 180;

/** "#luce notte" searches the tag "luce" for "notte"; "notte" searches text only. */
export function parseQuery(
  input: string,
  pickedTag: string | null = null,
): { q?: string; tag?: string } {
  const text = input.trim();
  if (pickedTag && (text === `#${pickedTag}` || text.startsWith(`#${pickedTag} `))) {
    const rest = text.slice(pickedTag.length + 1).trim();
    return { tag: pickedTag, ...(rest.length >= 2 ? { q: rest } : {}) };
  }
  const tag = /(^|\s)#(\S+)/.exec(text)?.[2];
  const q = text.replace(/(^|\s)#\S+/, ' ').trim();
  return { ...(q.length >= 2 ? { q } : {}), ...(tag ? { tag } : {}) };
}

const ICONS: Record<string, IconName> = {
  note: 'note',
  image: 'image',
  link: 'link',
  file: 'file',
  todo: 'todo',
  color: 'color',
  column: 'column',
  board: 'board',
  scene: 'scene',
  frame: 'frame',
  arrow: 'arrow',
  character: 'user',
  location: 'pin',
};

function iconOf(hit: SearchHit): IconName {
  if (hit.kind === 'project') return 'home';
  if (hit.kind === 'board') return hit.boardKind === 'storyboard' ? 'storyboard' : 'board';
  return ICONS[hit.elementType ?? ''] ?? 'note';
}

/** Search across every project the person can open; ⌘K or the search buttons open it. */
export function SearchDialog({
  projects,
  shared,
  onClose,
  actions = [],
}: {
  actions?: PaletteAction[];
  projects: Project[] | null;
  shared: Board[] | null;
  onClose: () => void;
}) {
  const { tagLabel } = useClassifications();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [allProjects, setAllProjects] = useState<Project[] | null>(projects);
  const [availableTags, setAvailableTags] = useState<TagCount[]>([]);
  const [pickedTag, setPickedTag] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  // -1 means nothing is selected: Enter then does nothing until a row is picked.
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const contextual = useContextActions();
  // Tags filter the server search only; actions match the remaining words.
  const actionQuery = input.replace(/(^|\s)#\S*/g, ' ');
  const shownActions = rankActions([...actions, ...contextual], actionQuery);
  const hitCount = hits?.length ?? 0;
  const resultCount = hitCount + shownActions.length;
  function runAction(action: PaletteAction | undefined) {
    if (!action) return;
    onClose();
    action.run();
  }
  useEffect(() => {
    document.getElementById(`search-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  // Read during the first render, before autoFocus moves focus into the field.
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );

  useEffect(() => {
    if (projects) {
      setAllProjects(projects);
      return;
    }
    loadProjects()
      .then(setAllProjects)
      .catch(() => {});
  }, [projects]);

  useEffect(() => {
    setAvailableTags([]);
    const ids = [
      ...new Set([
        ...(allProjects ?? []).map((p) => p.id),
        ...(shared ?? []).map((b) => b.projectId),
      ]),
    ];
    if (ids.length === 0) return;
    let alive = true;
    loadTagsForProjects(ids).then((tags) => {
      if (alive) setAvailableTags(tags);
    });
    return () => {
      alive = false;
    };
  }, [allProjects, shared]);

  const isTagInput = input.trimStart().startsWith('#');
  const rawAfterHash = input.trimStart().slice(1);
  const hasSpace = rawAfterHash.includes(' ');
  const tagQuery = normaliseTag(hasSpace ? (rawAfterHash.split(/\s+/)[0] ?? '') : rawAfterHash);
  const showingSuggestions =
    isTagInput && !hasSpace && (pickedTag === null || pickedTag.toLowerCase() !== tagQuery);
  const suggestions = showingSuggestions
    ? availableTags.filter((s) => tagLabel(s.tag).toLowerCase().includes(tagQuery)).slice(0, 20)
    : [];

  useEffect(() => {
    const count = showingSuggestions ? suggestions.length : resultCount;
    setActive((current) => Math.min(current, count - 1));
  }, [resultCount, showingSuggestions, suggestions.length]);

  function pickTag(tag: string) {
    const normalised = normaliseTag(tagLabel(tag));
    setPickedTag(normalised);
    setInput(`#${normalised}`);
    setActive(-1);
  }

  const query = useMemo(() => parseQuery(input, pickedTag), [input, pickedTag]);

  useEffect(() => {
    const n = ++seq.current;
    if (!query.q && !query.tag) {
      setHits(null);
      setState('idle');
      return;
    }
    // Earlier results stay listed until the new ones arrive.
    setState('loading');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ ...query, limit: '30' });
      api
        .get<SearchResult>(`/search?${params}`)
        .then((r) => {
          if (n !== seq.current) return;
          setHits(r.items);
          setActive(r.items.length > 0 ? 0 : -1);
          setState('idle');
        })
        .catch(() => n === seq.current && setState('error'));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function open(hit: SearchHit | undefined) {
    if (!hit) return;
    onClose();
    const root = allProjects?.find((p) => p.id === hit.projectId)?.rootBoardId;
    if (hit.kind === 'project' || !hit.boardId) {
      navigate(`/p/${hit.projectId}`);
      return;
    }
    const path = boardPath(hit.projectId, hit.boardId, root);
    if (hit.kind === 'board') {
      navigate(path);
      return;
    }
    // Cards open on the canvas, selected; storyboards would open on the storyboard view.
    const params = new URLSearchParams({ el: hit.elementId ?? '' });
    if (hit.boardKind === 'storyboard') params.set('view', 'canvas');
    navigate(`${path}?${params}`);
  }

  return (
    <div className="search__backdrop" onPointerDown={onClose}>
      <dialog
        open
        className="search ink-motion-dialog"
        aria-label={t('search.title')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="search__field">
          <Icon name="search" size={16} />
          <input
            className="search__input"
            autoFocus
            value={input}
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-activedescendant={
              active >= 0 && (showingSuggestions ? suggestions.length : resultCount) > active
                ? `search-option-${active}`
                : undefined
            }
            aria-controls="search-results"
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
              setActive(next.trimStart().startsWith('#') ? 0 : -1);
              if (
                pickedTag &&
                next.trim() !== `#${pickedTag}` &&
                !next.trimStart().startsWith(`#${pickedTag} `)
              ) {
                setPickedTag(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
                e.preventDefault();
                return;
              }
              if (showingSuggestions) {
                const count = suggestions.length;
                if (e.key === 'ArrowDown') {
                  setActive((a) => Math.max(0, Math.min(count - 1, a + 1)));
                  e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                  setActive((a) => Math.max(0, a - 1));
                  e.preventDefault();
                } else if (e.key === 'Enter') {
                  if (suggestions[active]) {
                    pickTag(suggestions[active].tag);
                  } else if (tagQuery) {
                    pickTag(tagQuery);
                  }
                  e.preventDefault();
                }
                return;
              }
              const count = resultCount;
              if (e.key === 'ArrowDown') setActive((a) => Math.max(0, Math.min(count - 1, a + 1)));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter') {
                if (active < 0) return;
                if (active < hitCount) open(hits?.[active]);
                else runAction(shownActions[active - hitCount]);
              } else return;
              e.preventDefault();
            }}
          />
        </div>
        <div className="search__list">
          {showingSuggestions && suggestions.length === 0 && (
            <p className="ink-muted search__note">{t('search.noTags')}</p>
          )}
          {!showingSuggestions && (
            <>
              {!hits && state !== 'error' && (
                <p className="ink-muted search__note">
                  {state === 'loading' ? t('search.loading') : t('search.hint')}
                </p>
              )}
              {state === 'error' && <p className="ink-muted search__note">{t('search.error')}</p>}
              {hits?.length === 0 && shownActions.length === 0 && state !== 'loading' && (
                <p className="ink-muted search__note">{t('search.none', { q: input.trim() })}</p>
              )}
            </>
          )}
          <div id="search-results" role="listbox" aria-label={t('search.title')}>
            {showingSuggestions ? (
              suggestions.map((s, i) => (
                <button
                  id={`search-option-${i}`}
                  tabIndex={-1}
                  onPointerDown={(e) => e.preventDefault()}
                  key={s.tag}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className="search__item"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pickTag(s.tag)}
                >
                  <Icon name="tag" size={16} />
                  <span className="search__text">
                    <span className="search__title">#{tagLabel(s.tag)}</span>
                    <span className="search__where">
                      {t('search.tagCardCount', { count: s.count })}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <>
                {hits?.map((hit, i) => (
                  <button
                    id={`search-option-${i}`}
                    tabIndex={-1}
                    onPointerDown={(e) => e.preventDefault()}
                    key={`${hit.kind}-${hit.boardId}-${hit.elementId ?? hit.projectId}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className="search__item"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(hit)}
                  >
                    <Icon
                      name={iconOf(hit)}
                      contentKind={hit.kind === 'board' ? (hit.boardKind ?? 'board') : undefined}
                      size={16}
                    />
                    <span className="search__text">
                      <span className="search__title">{hit.title}</span>
                      {hit.snippet && hit.snippet !== hit.title && (
                        <span className="search__snippet">{hit.snippet}</span>
                      )}
                      <span className="search__where">
                        {hit.kind === 'project'
                          ? t('search.kinds.project')
                          : [hit.boardTitle, t('search.inProject', { project: hit.projectName })]
                              .filter(Boolean)
                              .join(' · ')}
                        {hit.tags.length > 0 && ` · #${hit.tags.map(tagLabel).join(' #')}`}
                      </span>
                    </span>
                  </button>
                ))}
                {shownActions.length > 0 && (
                  // biome-ignore lint/a11y/useSemanticElements: a listbox may only own options and ARIA groups.
                  <div role="group" aria-label={t('search.actions')}>
                    <p aria-hidden="true" className="ink-muted search__note">
                      {t('search.actions')}
                    </p>
                    {shownActions.map((action, i) => (
                      <button
                        key={action.id}
                        id={`search-option-${hitCount + i}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        onPointerDown={(e) => e.preventDefault()}
                        aria-selected={hitCount + i === active}
                        className="search__item"
                        onMouseEnter={() => setActive(hitCount + i)}
                        onClick={() => runAction(action)}
                      >
                        <Icon name="arrow" size={16} />
                        <span className="search__text">{action.label}</span>
                        {action.hint && <KeyCap>{action.hint}</KeyCap>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
