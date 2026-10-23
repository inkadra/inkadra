import type { Project, SearchHit, SearchResult } from '@inkadra/shared';
import { Icon, type IconName } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { boardPath } from '../board/BoardPage.tsx';
import { api } from '../lib/api.ts';
import './search.css';

const DEBOUNCE_MS = 180;

/** "#luce notte" searches the tag "luce" for "notte"; "notte" searches text only. */
export function parseQuery(input: string): { q?: string; tag?: string } {
  const text = input.trim();
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
  onClose,
}: {
  projects: Project[] | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const query = parseQuery(input);
  const key = JSON.stringify(query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `query`
  useEffect(() => {
    if (!query.q && !query.tag) {
      setHits(null);
      setState('idle');
      return;
    }
    const n = ++seq.current;
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
    const root = projects?.find((p) => p.id === hit.projectId)?.rootBoardId;
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
            aria-expanded={!!hits}
            aria-controls="search-results"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              const count = hits?.length ?? 0;
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') setActive((a) => Math.min(count - 1, a + 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter') open(hits?.[active]);
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <div id="search-results" role="listbox" className="search__list">
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
        </div>
      </dialog>
    </div>
  );
}
