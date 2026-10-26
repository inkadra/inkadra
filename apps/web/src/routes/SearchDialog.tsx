import type { Board, Project, SearchHit, SearchResult, TagCount } from '@inkadra/shared';
import { Icon, type IconName } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { boardPath } from '../board/boards.ts';
import { filterTagSuggestions, loadTagsForProjects, normaliseTag } from '../board/tags.tsx';
import { api } from '../lib/api.ts';
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
}: {
  projects: Project[] | null;
  shared: Board[] | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [allProjects, setAllProjects] = useState<Project[] | null>(projects);
  const [availableTags, setAvailableTags] = useState<TagCount[]>([]);
  const [pickedTag, setPickedTag] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const seq = useRef(0);

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
  const suggestions = showingSuggestions ? filterTagSuggestions(availableTags, tagQuery) : [];

  function pickTag(tag: string) {
    const normalised = normaliseTag(tag);
    setPickedTag(normalised);
    setInput(`#${normalised}`);
    setActive(0);
  }

  const query = parseQuery(input, pickedTag);
  const key = JSON.stringify(query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `query`
  useEffect(() => {
    const n = ++seq.current;
    if (!query.q && !query.tag) {
      setHits(null);
      setState('idle');
      return;
    }
    setState('loading');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ ...query, limit: '30' });
      api
        .get<SearchResult>(`/search?${params}`)
        .then((r) => {
          if (n !== seq.current) return;
          setHits(r.items);
          setActive(0);
          setState('idle');
        })
        .catch(() => n === seq.current && setState('error'));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

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
        className="search"
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
            aria-expanded={showingSuggestions ? suggestions.length > 0 : !!hits}
            aria-controls="search-results"
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
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
                  setActive((a) => Math.min(count - 1, a + 1));
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
              const count = hits?.length ?? 0;
              if (e.key === 'ArrowDown') setActive((a) => Math.min(count - 1, a + 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter') open(hits?.[active]);
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <div id="search-results" role="listbox" className="search__list">
          {showingSuggestions ? (
            <>
              {suggestions.length === 0 && (
                <p className="ink-muted search__note">{t('search.noTags')}</p>
              )}
              {suggestions.map((s, i) => (
                <button
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
                    <span className="search__title">#{s.tag}</span>
                    <span className="search__where">
                      {t('search.tagCardCount', { count: s.count })}
                    </span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {!hits && state !== 'error' && (
                <p className="ink-muted search__note">
                  {state === 'loading' ? t('search.loading') : t('search.hint')}
                </p>
              )}
              {state === 'error' && <p className="ink-muted search__note">{t('search.error')}</p>}
              {hits?.length === 0 && (
                <p className="ink-muted search__note">{t('search.none', { q: input.trim() })}</p>
              )}
              {hits?.map((hit, i) => (
                <button
                  key={`${hit.kind}-${hit.boardId}-${hit.elementId ?? hit.projectId}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className="search__item"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => open(hit)}
                >
                  <Icon name={iconOf(hit)} size={16} />
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
                      {hit.tags.length > 0 && ` · #${hit.tags.join(' #')}`}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
